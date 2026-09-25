// IndexedDB への保存。状態は1つのレコードとして丸ごと書く。
// IndexedDB が使えない環境（一部のプライベートブラウズなど）では、保存せずにそのまま動く。

const DB_NAME = 'kuragebin';
const STORE = 'state';
const KEY = 'main';

export interface StateStore {
  load(): Promise<unknown>;
  save(data: unknown): Promise<void>;
  /** 読めなかったデータを消さずに取っておく */
  keep(key: string, data: unknown): Promise<void>;
  /** 保存できる環境か */
  readonly persistent: boolean;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB が開けません'));
  });
}

class IdbStore implements StateStore {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}

  async load(): Promise<unknown> {
    const tx = this.db.transaction(STORE, 'readonly');
    return (await request(tx.objectStore(STORE).get(KEY))) ?? null;
  }

  save(data: unknown): Promise<void> {
    return this.put(KEY, data);
  }

  keep(key: string, data: unknown): Promise<void> {
    return this.put(key, data);
  }

  private put(key: string, data: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

/** 保存しない代わりの入れ物 */
class MemoryStore implements StateStore {
  readonly persistent = false;
  private data: unknown = null;
  async load(): Promise<unknown> {
    return this.data;
  }
  async save(data: unknown): Promise<void> {
    this.data = data;
  }
  async keep(): Promise<void> {}
}

export async function openStateStore(): Promise<StateStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryStore();
    return new IdbStore(await openDb());
  } catch {
    return new MemoryStore();
  }
}

export function memoryStore(): StateStore {
  return new MemoryStore();
}
