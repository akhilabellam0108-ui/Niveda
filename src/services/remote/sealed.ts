/** Decrypting mental-health and sensitive entries (stored encrypted in the database). */
import { read } from './client';
import { isSealed, toRecord } from './mappers';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Replaces encrypted contents with plaintext from the database (only for entries this person may see). */
export async function openSealed<T extends Row>(rows: T[]): Promise<T[]> {
  const ids = rows.filter((r) => isSealed(r.data)).map((r) => r.id as string);
  if (!ids.length) return rows;
  const plain = await read<Record<string, { data: Row; versions: Record<string, Row> }>>('open_records', { p_ids: ids });
  return rows.map((r) => {
    const p = plain[r.id];
    if (!p) return r;
    const versions = (r.record_versions as Row[] | undefined)?.map((v) => ({ ...v, data: p.versions[String(v.version)] ?? v.data }));
    return { ...r, data: p.data, ...(versions ? { record_versions: versions } : {}) };
  });
}

export const toRecords = async (rows: Row[]) => (await openSealed(rows)).map(toRecord);
