/**
 * Stores document file contents. Uses IndexedDB in the browser, memory elsewhere.
 * In production, files live in private object storage and are served through
 * short-lived signed URLs after a permission check — never through public links.
 */
const DB_NAME = 'niveda-files';
const STORE = 'files';
const mem = new Map<string, Blob>();

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const idb = () => (dbPromise ??= openIdb());

export async function putBlob(id: string, blob: Blob): Promise<void> {
  mem.set(id, blob);
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function getBlob(id: string): Promise<Blob | null> {
  if (mem.has(id)) return mem.get(id)!;
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => res((req.result as Blob) ?? null);
    req.onerror = () => res(null);
  });
}

export async function deleteBlob(id: string): Promise<void> {
  mem.delete(id);
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function clearBlobs(): Promise<void> {
  mem.clear();
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
