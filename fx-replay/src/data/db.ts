import type { Columns } from './csv';

export type DatasetRecord = {
  symbol: string;
  timeframe: string;
  count: number;
  from: number;
  to: number;
  savedAt: number;
  columns: Columns;
};

export type TradeRecord = {
  id?: number;
  symbol: string;
  side: 'buy' | 'sell';
  entry: number;
  exit: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity: number;
  pnl: number;
  risk: number;
  r: number | null;
  openedAt: number;
  closedAt: number;
  reason: 'stopLoss' | 'takeProfit' | 'close' | 'reverse' | 'order' | 'manual';
};

const DB_NAME = 'fx-replay';
const DB_VERSION = 1;

let handle: Promise<IDBDatabase> | null = null;

export function db(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('datasets')) {
        database.createObjectStore('datasets', { keyPath: 'symbol' });
      }
      if (!database.objectStoreNames.contains('trades')) {
        const store = database.createObjectStore('trades', { keyPath: 'id', autoIncrement: true });
        store.createIndex('closedAt', 'closedAt');
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return handle;
}

function tx<T>(store: 'datasets' | 'trades' | 'meta', mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function saveDataset(record: DatasetRecord, keepOnly = true): Promise<void> {
  if (keepOnly) {
    const existing = await listDatasets();
    for (const other of existing) {
      if (other.symbol !== record.symbol) await deleteDataset(other.symbol);
    }
  }
  const c = record.columns;
  const compact: DatasetRecord = {
    ...record,
    columns: {
      time: c.time.slice(),
      open: c.open.slice(),
      high: c.high.slice(),
      low: c.low.slice(),
      close: c.close.slice(),
      volume: c.volume.slice(),
    },
  };
  await tx('datasets', 'readwrite', (s) => s.put(compact));
}

export async function listDatasets(): Promise<DatasetRecord[]> {
  const all = await tx<DatasetRecord[]>('datasets', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function loadDataset(symbol: string): Promise<DatasetRecord | undefined> {
  return tx<DatasetRecord | undefined>('datasets', 'readonly', (s) => s.get(symbol));
}

export async function deleteDataset(symbol: string): Promise<void> {
  await tx('datasets', 'readwrite', (s) => s.delete(symbol));
}

export async function addTrade(trade: TradeRecord): Promise<void> {
  await tx('trades', 'readwrite', (s) => s.add(trade));
}

export async function listTrades(): Promise<TradeRecord[]> {
  const all = await tx<TradeRecord[]>('trades', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.closedAt - b.closedAt);
}

export async function clearTrades(): Promise<void> {
  await tx('trades', 'readwrite', (s) => s.clear());
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>('meta', 'readonly', (s) => s.get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx('meta', 'readwrite', (s) => s.put(value, key));
}
