import type { ForkNode, Annotation, PersistentHighlight, HighlightRecord } from './types';

// Local snapshot of the last-opened sessions so a reload/relaunch paints
// instantly from device storage while the authoritative GET /sessions/:id runs
// in the background. IndexedDB over localStorage: full sessions can exceed the
// ~5MB string budget, and structured clone skips JSON.parse on the main thread.
// Everything here is best-effort — callers must treat failures as a cache miss.

const DB_NAME = 'forkai';
const STORE = 'sessions';
const MAX_SESSIONS = 10;

export interface CachedSession {
  sessionId: string;
  rootId: string;
  nodes: Record<string, ForkNode>;
  annotations: Annotation[];
  persistentHl: Record<string, PersistentHighlight[]>;
  highlightsList: HighlightRecord[];
  notionPageUrl: string | null;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'sessionId' });
      store.createIndex('savedAt', 'savedAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getCachedSession(sessionId: string): Promise<CachedSession | null> {
  const db = await openDb();
  try {
    const req = db.transaction(STORE).objectStore(STORE).get(sessionId);
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as CachedSession | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putCachedSession(snap: CachedSession): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(snap);
    // Evict the oldest snapshots beyond the cap so the store can't grow unbounded.
    const keysReq = store.index('savedAt').getAllKeys();
    keysReq.onsuccess = () => {
      const excess = keysReq.result.length - MAX_SESSIONS;
      // getAllKeys on the savedAt index returns primary keys in oldest-first order.
      for (let i = 0; i < excess; i++) store.delete(keysReq.result[i]);
    };
    await done(tx);
  } finally {
    db.close();
  }
}

export async function deleteCachedSession(sessionId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(sessionId);
    await done(tx);
  } finally {
    db.close();
  }
}
