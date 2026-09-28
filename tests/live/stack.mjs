// A local stand-in for a Supabase project, for end-to-end tests of the live app code:
//   - the real Supabase Auth server (GoTrue) and the real PostgREST, both as binaries
//   - a small storage API that stores files in Postgres and applies the same
//     row-level security as Supabase Storage (it runs every query as the caller)
//   - an SMTP catcher, so tests can read the one-time codes Auth emails out
// Everything sits behind one URL, like https://<project>.supabase.co.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import pg from 'pg';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(payload, secret) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
function verifyJwt(token, secret) {
  const [h, p, s] = (token ?? '').split('.');
  if (!s || createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
}

const TEMPLATE = '<p>Your Niveda code is <b>{{ .Token }}</b></p>';

export async function startStack({ pgHost, pgPort, db, bin, port = 54321 }) {
  const secret = 'niveda-local-test-secret-at-least-32-characters';
  const now = Math.floor(Date.now() / 1000);
  const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat: now, exp: now + 86400 }, secret);
  const serviceKey = signJwt({ role: 'service_role', iss: 'supabase', iat: now, exp: now + 86400 }, secret);
  const children = [];
  const inbox = [];

  /* ---- SMTP catcher ---- */
  const smtp = net.createServer((sock) => {
    let data = false; let buf = ''; let msg = '';
    sock.write('220 localhost ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; inbox.push(msg); msg = ''; sock.write('250 OK\r\n'); } else msg += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
        else if (cmd === 'HELO') sock.write('250 localhost\r\n');
        else if (cmd === 'AUTH') sock.write('235 OK\r\n');
        else if (cmd === 'DATA') { data = true; sock.write('354 End with .\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => smtp.listen(2525, r));

  /* ---- Postgres pool for the storage stand-in ---- */
  const pool = new pg.Pool({ host: pgHost, port: pgPort, user: 'postgres', database: db, max: 5 });

  async function asCaller(claims, fn) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (claims.role !== 'service_role') {
        await c.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
      }
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  function readBody(req) {
    return new Promise((resolve) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => resolve(Buffer.concat(parts))); });
  }

  /** Pulls the file out of the multipart body storage-js sends. */
  function fileFromMultipart(body, contentType) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
    if (!m) return { data: body, type: contentType };
    const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
    let start = body.indexOf(boundary);
    while (start >= 0) {
      const next = body.indexOf(boundary, start + boundary.length);
      if (next < 0) break;
      const part = body.subarray(start + boundary.length + 2, next - 2);
      const headEnd = part.indexOf('\r\n\r\n');
      const head = part.subarray(0, headEnd).toString();
      if (/filename=/.test(head) || /name=""/.test(head)) {
        const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
        return { data: part.subarray(headEnd + 4), type };
      }
      start = next;
    }
    return { data: body, type: contentType };
  }

  const send = (res, status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };

  async function storage(req, res, path) {
    const claims = verifyJwt((req.headers.authorization ?? '').replace(/^Bearer /, ''), secret);
    if (!claims) return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'Invalid JWT' });
    const m = /^\/object\/([^/]+)(?:\/(.*))?$/.exec(path.split('?')[0]);
    if (!m) return send(res, 404, { message: 'not found' });
    const bucket = decodeURIComponent(m[1]);
    const name = m[2] ? decodeURIComponent(m[2]) : '';
    try {
      if (req.method === 'POST' && name) {
        const { data, type } = fileFromMultipart(await readBody(req), req.headers['content-type']);
        const [b] = (await pool.query('select * from storage.buckets where id = $1', [bucket])).rows;
        if (!b) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
        if (b.file_size_limit && data.length > Number(b.file_size_limit)) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        if (b.allowed_mime_types && type && !b.allowed_mime_types.includes(type)) return send(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
        await asCaller(claims, (c) => c.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, name, claims.sub]));
        await pool.query('insert into storage.blobs (name, data, content_type) values ($1, $2, $3)', [`${bucket}/${name}`, data, type]);
        return send(res, 200, { Key: `${bucket}/${name}`, Id: name });
      }
      if (req.method === 'GET' && name) {
        const rows = await asCaller(claims, (c) => c.query('select name from storage.objects where bucket_id = $1 and name = $2', [bucket, name]).then((r) => r.rows));
        if (!rows.length) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        const [blob] = (await pool.query('select data, content_type from storage.blobs where name = $1', [`${bucket}/${name}`])).rows;
        res.writeHead(200, { 'content-type': blob?.content_type ?? 'application/octet-stream' });
        return res.end(blob?.data ?? Buffer.alloc(0));
      }
      if (req.method === 'DELETE' && !name) {
        const { prefixes } = JSON.parse((await readBody(req)).toString() || '{}');
        const rows = await asCaller(claims, (c) => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, prefixes]).then((r) => r.rows));
        for (const r of rows) await pool.query('delete from storage.blobs where name = $1', [`${bucket}/${r.name}`]);
        return send(res, 200, rows.map((r) => ({ name: r.name })));
      }
      return send(res, 404, { message: 'not supported here' });
    } catch (e) {
      const rls = /row-level security|permission denied/.test(e.message);
      return send(res, 400, { statusCode: rls ? '403' : '500', error: rls ? 'Unauthorized' : 'internal', message: rls ? 'new row violates row-level security policy' : e.message });
    }
  }

  /* ---- Auth and PostgREST ---- */
  const env = {
    ...process.env,
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_NAMESPACE: 'auth', DATABASE_URL: `postgres://supabase_auth_admin@localhost:${pgPort}/${db}?sslmode=disable`,
    GOTRUE_DB_MIGRATIONS_PATH: `${bin}/migrations`, GOTRUE_API_HOST: 'localhost', PORT: '9999',
    API_EXTERNAL_URL: `http://localhost:${port}/auth/v1`, GOTRUE_SITE_URL: 'http://localhost:5173',
    GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_MAILER_OTP_EXP: '600', GOTRUE_MAILER_OTP_LENGTH: '6',
    GOTRUE_SMTP_HOST: 'localhost', GOTRUE_SMTP_PORT: '2525', GOTRUE_SMTP_USER: 'test', GOTRUE_SMTP_PASS: 'test', GOTRUE_SMTP_ADMIN_EMAIL: 'no-reply@niveda.test', GOTRUE_SMTP_MAX_FREQUENCY: '1s',
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '10000', GOTRUE_RATE_LIMIT_VERIFY: '10000', GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '10000', GOTRUE_RATE_LIMIT_OTP: '10000',
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION: `http://localhost:${port}/tmpl`, GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: `http://localhost:${port}/tmpl`,
    GOTRUE_MAILER_TEMPLATES_RECOVERY: `http://localhost:${port}/tmpl`, GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE: `http://localhost:${port}/tmpl`,
    GOTRUE_LOG_LEVEL: 'warn',
    // PostgREST
    PGRST_DB_URI: `postgres://authenticator@localhost:${pgPort}/${db}`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: secret, PGRST_SERVER_PORT: '3000', PGRST_LOG_LEVEL: 'crit', PGRST_DB_MAX_ROWS: '1000',
  };

  const proxy = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/tmpl')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(TEMPLATE); }
    if (url.startsWith('/storage/v1')) return storage(req, res, url.slice('/storage/v1'.length));
    const target = url.startsWith('/auth/v1') ? `http://localhost:9999${url.slice(8)}` : url.startsWith('/rest/v1') ? `http://localhost:3000${url.slice(8)}` : null;
    if (!target) return send(res, 404, { message: 'unknown route' });
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const headers = { ...req.headers };
    delete headers.host; delete headers['content-length']; delete headers.connection;
    try {
      const r = await fetch(target, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer());
      const h = {};
      r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(k)) h[k] = v; });
      res.writeHead(r.status, h);
      res.end(out);
    } catch (e) {
      send(res, 502, { message: e.message });
    }
  });
  await new Promise((r) => proxy.listen(port, r));

  const run = (cmd, args = []) => {
    const p = spawn(cmd, args, { env, cwd: bin, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    children.push(p);
    return () => err;
  };
  const authLog = run(`${bin}/auth`);
  const restLog = run(`${bin}/postgrest`);
  const ready = async (u) => {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(u); if (r.status < 500) return; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${u} didn't start.\nauth: ${authLog()}\nrest: ${restLog()}`);
  };
  await ready('http://localhost:9999/health');
  await ready('http://localhost:3000/');

  return {
    url: `http://localhost:${port}`, anonKey, serviceKey, secret, pool,
    /** The most recent 6-digit code emailed to this address. */
    async codeFor(email, since = 0) {
      for (let i = 0; i < 50; i++) {
        const mail = inbox.slice(since).reverse().find((m) => m.toLowerCase().includes(`to: ${email.toLowerCase()}`) || m.toLowerCase().includes(`<${email.toLowerCase()}>`));
        const code = mail && /code is <b>(\d{6})<\/b>/.exec(mail.replace(/=\r?\n/g, '').replace(/=3D/g, '='))?.[1];
        if (code) return code;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`No code emailed to ${email}`);
    },
    mailCount: () => inbox.length,
    async stop() {
      for (const c of children) c.kill();
      await pool.end();
      await new Promise((r) => proxy.close(r));
      await new Promise((r) => smtp.close(r));
    },
  };
}
