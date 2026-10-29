// Minimal IndexedDB key-value wrapper. Two stores: "cache" (Spotify tracks, Last.fm tags;
// cleared by the "Limpar cache" button) and "state" (the analysis run, for resuming).
// Every call degrades to a miss / no-op when IndexedDB is unavailable.

const DB_NAME = "playlist-splitter";
export type StoreName = "cache" | "state";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("cache");
      req.result.createObjectStore("state");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    // allow a later retry instead of caching the failure
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = op(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    return (await run(store, "readonly", (s) => s.get(key))) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function idbSet(store: StoreName, key: string, value: unknown) {
  try {
    await run(store, "readwrite", (s) => s.put(value, key));
  } catch {
    // quota / blocked storage: the in-memory state still works for this page load
  }
}

export async function idbDelete(store: StoreName, key: string) {
  try {
    await run(store, "readwrite", (s) => s.delete(key));
  } catch {
    // ignore
  }
}

export async function idbClear(store: StoreName) {
  try {
    await run(store, "readwrite", (s) => s.clear());
  } catch {
    // ignore
  }
}
