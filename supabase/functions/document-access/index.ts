// Supabase Edge Function: the only way to read an uploaded document.
//
//   POST { action: "open", id }  → the file, after open_document() has checked the
//                                   person's access and written the view to the log
//   POST { action: "scan", id }  → checks a new upload right away (it is otherwise
//                                   checked the first time it's opened)
//
// Every file is checked (scan.ts) before it can be opened the first time; a file
// that fails is deleted from storage and marked blocked.
//
// Deploy: supabase functions deploy document-access   (JWT verification on: callers
// must be signed in). No secrets to set.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { scanFile, SAFE_CONTENT_TYPE, type FileKind } from './scan.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const BUCKET = 'documents';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'x-niveda-type, x-niveda-name',
};
const fail = (status: number, code: string, message: string) => Response.json({ code, message }, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'VALIDATION', 'Use POST.');
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer .+/.test(auth)) return fail(401, 'NOT_SIGNED_IN', 'Please sign in to continue.');
  const { action, id } = await req.json().catch(() => ({})) as { action?: string; id?: string };
  if (!id || !/^doc_[a-z0-9]{8,32}$/.test(id) || (action !== 'open' && action !== 'scan')) return fail(400, 'VALIDATION', 'Unknown request.');

  const url = env('SUPABASE_URL');
  // As the person: the database decides whether they may see this document (and logs it).
  const asUser = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  // As the server: reads the file and records the check.
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const { data: info, error } = await asUser.rpc(action === 'open' ? 'open_document' : 'document_for_scan', { p_doc: id });
  if (error || !info) {
    const m = /^([A-Z_]+): ([\s\S]*)$/.exec(error?.message ?? '');
    return fail(403, m?.[1] ?? 'ACCESS_DENIED', m?.[2] ?? 'This document isn’t available.');
  }
  const doc = info as { path: string; mime: string; name?: string; scanStatus: 'pending' | 'clean' | 'blocked'; scanNote?: string };
  if (doc.scanStatus === 'blocked') return fail(422, 'BLOCKED', `This file was blocked by Niveda’s safety check. ${doc.scanNote ?? ''}`.trim());

  let kind: FileKind | undefined;
  let buf: ArrayBuffer | undefined;
  if (doc.scanStatus === 'pending' || action === 'open') {
    const { data: file, error: dl } = await admin.storage.from(BUCKET).download(doc.path);
    if (dl || !file) return fail(404, 'NOT_FOUND', 'The file for this document couldn’t be found. Please try again.');
    buf = await file.arrayBuffer();
    const result = scanFile(new Uint8Array(buf), doc.mime);
    if (doc.scanStatus === 'pending') {
      await admin.rpc('_set_document_scan', { p_doc: id, p_status: result.ok ? 'clean' : 'blocked', p_note: result.ok ? null : result.reason });
      if (!result.ok) {
        await admin.storage.from(BUCKET).remove([doc.path]);
        return fail(422, 'BLOCKED', `This file was blocked by Niveda’s safety check. ${result.reason}`);
      }
    } else if (!result.ok) {
      return fail(422, 'BLOCKED', `This file was blocked by Niveda’s safety check. ${result.reason}`);
    }
    kind = result.ok ? result.kind : undefined;
  }
  if (action === 'scan') return Response.json({ status: 'clean' }, { headers: CORS });

  return new Response(buf, {
    headers: {
      ...CORS,
      'content-type': 'application/octet-stream',
      'x-niveda-type': kind ? SAFE_CONTENT_TYPE[kind] : 'application/octet-stream',
      'x-niveda-name': encodeURIComponent(doc.name ?? 'document'),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});
