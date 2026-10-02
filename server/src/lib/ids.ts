import { randomBytes, randomInt, createHash } from 'node:crypto';

export const uid = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;
export const token = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join('');
export const phoneDigits = (s: string) => s.replace(/\D/g, '').slice(-10);
