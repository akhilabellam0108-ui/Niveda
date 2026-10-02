import multer from 'multer';
import type { Request } from 'express';
import { AppError, MAX_FILE_BYTES, DOC_CATEGORIES, guessCategory, type FileMeta } from '@shared/api';
import type { Upload } from '../services/records';

/** In-memory upload parser: files go straight to encryption, never to disk unencrypted. */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 12, fields: 20, fieldSize: 2 * 1024 * 1024 } });

/** Multipart requests carry a JSON "payload" field; plain JSON requests use the body directly. */
export function payloadOf<T>(req: Request): T {
  if (typeof req.body?.payload === 'string') {
    try { return JSON.parse(req.body.payload) as T; } catch { throw new AppError('VALIDATION', 'The request couldn’t be read.'); }
  }
  return req.body as T;
}

/** Pairs uploaded files with their metadata (same order). */
export function uploadsOf(req: Request, metas: FileMeta[] = []): Upload[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  return files.map((f, i) => {
    const m = metas[i] ?? { name: f.originalname, category: guessCategory({ name: f.originalname, type: f.mimetype }) };
    return { buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname, meta: { ...m, category: DOC_CATEGORIES.includes(m.category) ? m.category : 'other' } };
  });
}
