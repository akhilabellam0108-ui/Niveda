/**
 * Document storage. Files are encrypted with AES-256-GCM before they touch disk and are
 * only ever returned through an authenticated, permission-checked API route.
 * To move to S3/GCS, reimplement put/get/remove with the same signatures.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { sha256 } from '../lib/ids';

const VERSION = 1;

function keyPath(key: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Bad storage key');
  return path.join(config.storageDir, key.slice(0, 2), key);
}

export async function putFile(key: string, data: Buffer): Promise<{ sha256: string }> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.fileKey, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const out = Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
  const p = keyPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, out, { mode: 0o600 });
  return { sha256: sha256(data) };
}

export async function getFile(key: string): Promise<Buffer> {
  const buf = await readFile(keyPath(key));
  if (buf[0] !== VERSION) throw new Error('Unknown file format');
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', config.fileKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]);
}

export async function removeFile(key: string) {
  await rm(keyPath(key), { force: true });
}
