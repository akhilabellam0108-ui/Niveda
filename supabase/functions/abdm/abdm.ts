// ABHA (Ayushman Bharat Health Account) login through ABDM's V3 APIs.
// Kept free of Deno APIs so it can be unit-tested in Node (tests/edge.test.mjs).
//
// Flow (ABDM "M1" — verify a person owns an ABHA, then link it):
//   1. gateway session token (clientId + clientSecret from the ABDM sandbox/production)
//   2. POST /profile/login/request/otp   → OTP sent by ABDM to the ABHA's mobile; returns txnId
//   3. POST /profile/login/verify        → X-token for one ABHA, or a T-token + account list
//   4. POST /profile/login/verify/user   → X-token for the chosen ABHA (mobile logins only)
//   5. GET  /profile/account             → the ABHA profile we link to the Niveda record
// Every URL is configurable because ABDM moves them between versions.

export interface AbdmConfig {
  clientId: string;
  clientSecret: string;
  /** Gateway session URL. Sandbox default; production: https://apis.abdm.gov.in/api/hiecm/gateway/v3/sessions */
  sessionUrl: string;
  /** ABHA V3 base. Sandbox default; production base comes with your production approval. */
  abhaBase: string;
  /** "sbx" in the sandbox; the production CM id from NHA in production. */
  cmId: string;
}

export function configFromEnv(env: (k: string) => string): AbdmConfig {
  return {
    clientId: env('ABDM_CLIENT_ID'),
    clientSecret: env('ABDM_CLIENT_SECRET'),
    sessionUrl: env('ABDM_SESSION_URL') || 'https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions',
    abhaBase: (env('ABDM_ABHA_BASE') || 'https://abhasbx.abdm.gov.in/abha/api/v3').replace(/\/$/, ''),
    cmId: env('ABDM_CM_ID') || 'sbx',
  };
}

export type LoginMethod = 'abha-number' | 'mobile';

export interface AbhaProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  dateOfBirth: string; // YYYY-MM-DD when ABDM gives a full date, else what it gives
  gender: string;
  mobile: string;
}

/** ABHA numbers are 14 digits, shown as 12-3456-7890-1234. */
export function normaliseAbhaNumber(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.length !== 14) throw new Error('An ABHA number has 14 digits.');
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}`;
}

export function normaliseMobile(v: string): string {
  const d = v.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  if (!/^[6-9]\d{9}$/.test(ten)) throw new Error('Enter the 10-digit mobile number linked to your ABHA.');
  return ten;
}

export const maskAbhaNumber = (n: string) => `xx-xxxx-xxxx-${n.replace(/\D/g, '').slice(-4)}`;

/** Headers every ABDM call needs. */
export function headers(cfg: AbdmConfig, token: string | null, extra: Record<string, string> = {}, now = new Date(), id = crypto.randomUUID()): Record<string, string> {
  return {
    'content-type': 'application/json',
    'REQUEST-ID': id,
    TIMESTAMP: now.toISOString(),
    'X-CM-ID': cfg.cmId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/** PEM/base64 SPKI public key → CryptoKey for RSA-OAEP with SHA-1 (what ABDM requires). */
export async function importAbdmKey(pemOrBase64: string): Promise<CryptoKey> {
  const b64 = pemOrBase64.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['encrypt']);
}

/** RSA/ECB/OAEPWithSHA-1AndMGF1Padding, base64 — how ABDM wants loginId and OTP sent. */
export async function encrypt(key: CryptoKey, value: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(value)));
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

export const scopeFor = (_method: LoginMethod) => ['abha-login', 'mobile-verify'];

export function requestOtpBody(method: LoginMethod, encryptedLoginId: string) {
  return { scope: scopeFor(method), loginHint: method === 'mobile' ? 'mobile' : 'abha-number', loginId: encryptedLoginId, otpSystem: 'abdm' };
}

export function verifyOtpBody(method: LoginMethod, txnId: string, encryptedOtp: string) {
  return { scope: scopeFor(method), authData: { authMethods: ['otp'], otp: { txnId, otpValue: encryptedOtp } } };
}

export interface VerifyResult {
  /** X-token: lets us read one ABHA's profile. */
  xToken?: string;
  /** T-token: a mobile login that matched several ABHAs; pick one with verify/user. */
  tToken?: string;
  txnId?: string;
  accounts: { abhaNumber: string; name: string }[];
}

/** ABDM answers in a few shapes; take what we need from any of them. */
export function parseVerify(r: Record<string, unknown>): VerifyResult {
  if (r.authResult && r.authResult !== 'success') throw new Error(String(r.message ?? 'The code didn’t match.'));
  const tokens = (r.tokens ?? {}) as Record<string, string>;
  const token = (r.token as string) ?? tokens.token;
  const accounts = ((r.accounts ?? []) as Record<string, string>[]).map((a) => ({ abhaNumber: a.ABHANumber ?? a.abhaNumber ?? '', name: a.name ?? '' }));
  if (!token) throw new Error('ABDM didn’t return a session.');
  // A mobile login answers with a T-token that can only select an account.
  const isTToken = (r.tokenType as string)?.toUpperCase?.() === 'T-TOKEN' || (accounts.length > 1 && !tokens.refreshToken);
  return isTToken ? { tToken: token, txnId: r.txnId as string, accounts } : { xToken: token, txnId: r.txnId as string, accounts };
}

export function parseProfile(p: Record<string, unknown>): AbhaProfile {
  const abhaNumber = String(p.ABHANumber ?? p.abhaNumber ?? '');
  if (!abhaNumber) throw new Error('ABDM didn’t return an ABHA number.');
  const address = String(p.preferredAbhaAddress ?? p.abhaAddress ?? (Array.isArray(p.phrAddress) ? p.phrAddress[0] : '') ?? '');
  const name = String(p.name ?? [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')).trim();
  const y = String(p.yearOfBirth ?? ''), m = String(p.monthOfBirth ?? ''), d = String(p.dayOfBirth ?? '');
  let dob = String(p.dateOfBirth ?? p.dob ?? '');
  if (y && m && d) dob = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  else if (/^\d{2}-\d{2}-\d{4}$/.test(dob)) dob = `${dob.slice(6)}-${dob.slice(3, 5)}-${dob.slice(0, 2)}`;
  return { abhaNumber: normaliseAbhaNumber(abhaNumber), abhaAddress: address, name, dateOfBirth: dob, gender: String(p.gender ?? ''), mobile: String(p.mobile ?? '') };
}

/** Does the ABHA belong to the same person as the Niveda record? Name match is loose; DOB must match when ABDM gives a full date. */
export function matchesPatient(abha: Pick<AbhaProfile, 'name' | 'dateOfBirth'>, patient: { fullName: string; dateOfBirth: string }): { ok: boolean; reason?: string } {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const a = new Set(words(abha.name));
  const shared = words(patient.fullName).filter((w) => a.has(w)).length;
  if (shared === 0) return { ok: false, reason: 'The name on this ABHA doesn’t match the name on your Niveda record.' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(abha.dateOfBirth) && abha.dateOfBirth !== patient.dateOfBirth) {
    return { ok: false, reason: 'The date of birth on this ABHA doesn’t match your Niveda record.' };
  }
  return { ok: true };
}

/* ---------------- calls ---------------- */

type Fetch = typeof fetch;

async function call<T>(f: Fetch, url: string, init: RequestInit): Promise<T> {
  const r = await f(url, init);
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!r.ok) {
    const err = (body.error ?? body) as Record<string, unknown>;
    throw new Error(String(err.message ?? err.code ?? `ABDM error ${r.status}`));
  }
  return body as T;
}

export class AbdmClient {
  private token?: { value: string; until: number };
  private key?: CryptoKey;
  constructor(private cfg: AbdmConfig, private f: Fetch = fetch) {
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('ABDM_CLIENT_ID and ABDM_CLIENT_SECRET must be set');
  }

  async session(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const r = await call<{ accessToken: string; expiresIn?: number }>(this.f, this.cfg.sessionUrl, {
      method: 'POST', headers: headers(this.cfg, null),
      body: JSON.stringify({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret, grantType: 'client_credentials' }),
    });
    this.token = { value: r.accessToken, until: Date.now() + Math.max(60, (r.expiresIn ?? 600) - 60) * 1000 };
    return r.accessToken;
  }

  async publicKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    const r = await this.f(`${this.cfg.abhaBase}/profile/public/certificate`, { headers: headers(this.cfg, await this.session()) });
    if (!r.ok) throw new Error(`ABDM certificate error ${r.status}`);
    const text = await r.text();
    let pem = text;
    try { const j = JSON.parse(text); pem = j.publicKey ?? j.certificate ?? text; } catch { /* plain text */ }
    this.key = await importAbdmKey(pem);
    return this.key;
  }

  async requestOtp(method: LoginMethod, value: string): Promise<{ txnId: string; message: string }> {
    const loginId = method === 'mobile' ? normaliseMobile(value) : normaliseAbhaNumber(value);
    const body = requestOtpBody(method, await encrypt(await this.publicKey(), loginId));
    const r = await call<{ txnId: string; message?: string }>(this.f, `${this.cfg.abhaBase}/profile/login/request/otp`, {
      method: 'POST', headers: headers(this.cfg, await this.session()), body: JSON.stringify(body),
    });
    return { txnId: r.txnId, message: r.message ?? 'ABDM sent a code to the mobile number linked to your ABHA.' };
  }

  async verifyOtp(method: LoginMethod, txnId: string, otp: string): Promise<VerifyResult> {
    if (!/^\d{6}$/.test(otp)) throw new Error('Enter the 6-digit code from ABDM.');
    const body = verifyOtpBody(method, txnId, await encrypt(await this.publicKey(), otp));
    const r = await call<Record<string, unknown>>(this.f, `${this.cfg.abhaBase}/profile/login/verify`, {
      method: 'POST', headers: headers(this.cfg, await this.session()), body: JSON.stringify(body),
    });
    return parseVerify(r);
  }

  async selectAccount(txnId: string, tToken: string, abhaNumber: string): Promise<string> {
    const r = await call<Record<string, unknown>>(this.f, `${this.cfg.abhaBase}/profile/login/verify/user`, {
      method: 'POST', headers: headers(this.cfg, await this.session(), { 'T-token': `Bearer ${tToken}` }),
      body: JSON.stringify({ ABHANumber: normaliseAbhaNumber(abhaNumber), txnId }),
    });
    const v = parseVerify({ ...r, tokenType: 'X-TOKEN' });
    return v.xToken!;
  }

  async profile(xToken: string): Promise<AbhaProfile> {
    const r = await call<Record<string, unknown>>(this.f, `${this.cfg.abhaBase}/profile/account`, {
      method: 'GET', headers: headers(this.cfg, await this.session(), { 'X-token': `Bearer ${xToken}` }),
    });
    return parseProfile(r);
  }
}
