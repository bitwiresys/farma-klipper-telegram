/**
 * IndexedDB wrapper for offline-first data caching
 * Stores: presets, printers, history, syncQueue
 */

const DB_NAME = 'farma_offline_v1';
const DB_VERSION = 1;

export type PresetRow = {
  id: string;
  title: string;
  plasticType: string;
  colorHex: string;
  description: string | null;
  thumbnailUrl: string | null;
  gcodeMeta: any;
  compatibilityRules: any;
  _updatedAt: number;
};

export type PrinterRow = {
  id: string;
  displayName: string;
  modelId: string;
  modelName: string;
  bedX: number;
  bedY: number;
  bedZ: number;
  nozzleDiameter: number;
  needsRekey: boolean;
  snapshot: any;
  _updatedAt: number;
};

export type HistoryRow = {
  id: string;
  printerId: string;
  filename: string;
  status: string;
  thumbnailUrl: string | null;
  startedAt: string;
  endedAt: string | null;
  printDurationSec: number | null;
  totalDurationSec: number | null;
  filamentUsedMm: number | null;
  errorMessage: string | null;
  _updatedAt: number;
};

export type SyncQueueItem = {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'preset' | 'printer';
  data: any;
  createdAt: number;
  retries: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Presets store
      if (!db.objectStoreNames.contains('presets')) {
        const store = db.createObjectStore('presets', { keyPath: 'id' });
        store.createIndex('updatedAt', '_updatedAt');
      }

      // Printers store
      if (!db.objectStoreNames.contains('printers')) {
        const store = db.createObjectStore('printers', { keyPath: 'id' });
        store.createIndex('updatedAt', '_updatedAt');
      }

      // History store
      if (!db.objectStoreNames.contains('history')) {
        const store = db.createObjectStore('history', { keyPath: 'id' });
        store.createIndex('printerId', 'printerId');
        store.createIndex('startedAt', 'startedAt');
        store.createIndex('status', 'status');
      }

      // Sync queue for offline operations
      if (!db.objectStoreNames.contains('syncQueue')) {
        const store = db.createObjectStore('syncQueue', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
  });

  return dbPromise;
}

// Generic helpers
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStoreCursor<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>,
  process: (cursor: IDBCursorWithValue) => T | undefined,
): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = fn(store);
    const results: T[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const item = process(cursor);
        if (item) results.push(item);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// Presets
export async function savePresets(presets: PresetRow[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('presets', 'readwrite');
  const store = tx.objectStore('presets');
  const now = Date.now();

  for (const p of presets) {
    store.put({ ...p, _updatedAt: now });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllPresets(): Promise<PresetRow[]> {
  return withStoreCursor(
    'presets',
    'readonly',
    (s) => s.openCursor(),
    (c) => c.value as PresetRow,
  );
}

export async function getPresetsSince(since: number): Promise<PresetRow[]> {
  const db = await openDb();
  const tx = db.transaction('presets', 'readonly');
  const store = tx.objectStore('presets');
  const index = store.index('updatedAt');
  const range = IDBKeyRange.lowerBound(since);

  return new Promise((resolve, reject) => {
    const results: PresetRow[] = [];
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value as PresetRow);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearPresets(): Promise<void> {
  return withStore('presets', 'readwrite', (s) => s.clear()).then(() => {});
}

// Printers
export async function savePrinters(printers: PrinterRow[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('printers', 'readwrite');
  const store = tx.objectStore('printers');
  const now = Date.now();

  for (const p of printers) {
    store.put({ ...p, _updatedAt: now });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllPrinters(): Promise<PrinterRow[]> {
  return withStoreCursor(
    'printers',
    'readonly',
    (s) => s.openCursor(),
    (c) => c.value as PrinterRow,
  );
}

export async function getPrinter(id: string): Promise<PrinterRow | undefined> {
  return withStore('printers', 'readonly', (s) => s.get(id));
}

export async function updatePrinterSnapshot(
  id: string,
  snapshot: any,
): Promise<void> {
  const printer = await getPrinter(id);
  if (printer) {
    printer.snapshot = snapshot;
    printer._updatedAt = Date.now();
    await withStore('printers', 'readwrite', (s) => s.put(printer));
  }
}

// History
export async function saveHistory(history: HistoryRow[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  const now = Date.now();

  for (const h of history) {
    store.put({ ...h, _updatedAt: now });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllHistory(): Promise<HistoryRow[]> {
  return withStoreCursor(
    'history',
    'readonly',
    (s) => s.openCursor(),
    (c) => c.value as HistoryRow,
  );
}

export async function getHistoryByPrinter(
  printerId: string,
): Promise<HistoryRow[]> {
  const db = await openDb();
  const tx = db.transaction('history', 'readonly');
  const store = tx.objectStore('history');
  const index = store.index('printerId');
  const range = IDBKeyRange.only(printerId);

  return new Promise((resolve, reject) => {
    const results: HistoryRow[] = [];
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value as HistoryRow);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearHistory(): Promise<void> {
  return withStore('history', 'readwrite', (s) => s.clear()).then(() => {});
}

// Sync Queue
export async function addToSyncQueue(item: SyncQueueItem): Promise<void> {
  return withStore('syncQueue', 'readwrite', (s) => s.put(item)).then(() => {});
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return withStoreCursor(
    'syncQueue',
    'readonly',
    (s) => s.openCursor(),
    (c) => c.value as SyncQueueItem,
  );
}

export async function removeFromSyncQueue(id: string): Promise<void> {
  return withStore('syncQueue', 'readwrite', (s) => s.delete(id)).then(
    () => {},
  );
}

export async function clearSyncQueue(): Promise<void> {
  return withStore('syncQueue', 'readwrite', (s) => s.clear()).then(() => {});
}

// Clear all data
export async function clearAllData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(
    ['presets', 'printers', 'history', 'syncQueue'],
    'readwrite',
  );

  tx.objectStore('presets').clear();
  tx.objectStore('printers').clear();
  tx.objectStore('history').clear();
  tx.objectStore('syncQueue').clear();

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Database status
export async function getDbStatus(): Promise<{
  presets: number;
  printers: number;
  history: number;
  syncQueue: number;
}> {
  const db = await openDb();

  const count = (storeName: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const [presets, printers, history, syncQueue] = await Promise.all([
    count('presets'),
    count('printers'),
    count('history'),
    count('syncQueue'),
  ]);

  return { presets, printers, history, syncQueue };
}
