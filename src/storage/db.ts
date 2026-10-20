// IndexedDB への保存。状態は1つのレコードとして丸ごと書く。種のページの写真は、状態とは別の入れ物に1枚ずつ（状態を軽く保つため）。
// IndexedDB が使えない環境（一部のプライベートブラウズなど）では、保存せずにそのまま動く。

const DB_NAME = 'kuragebin';
/** 版 2 で写真の入れ物を足した */
const DB_VERSION = 2;
const STORE = 'state';
const PHOTOS = 'photos';
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
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      if (!req.result.objectStoreNames.contains(PHOTOS)) req.result.createObjectStore(PHOTOS);
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

/** 種のページの写真（番号 → 画像の data URL）。読み込んだら手元にも持つ（書き出しで使う） */
export interface PhotoStore {
  load(): Promise<Map<number, string>>;
  put(id: number, url: string): Promise<void>;
  remove(id: number): Promise<void>;
  readonly persistent: boolean;
}

class IdbPhotos implements PhotoStore {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}

  async load(): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const tx = this.db.transaction(PHOTOS, 'readonly');
    const store = tx.objectStore(PHOTOS);
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    keys.forEach((k, i) => {
      if (typeof k === 'number' && typeof values[i] === 'string') out.set(k, values[i] as string);
    });
    return out;
  }

  put(id: number, url: string): Promise<void> {
    return this.write((s) => s.put(url, id));
  }

  remove(id: number): Promise<void> {
    return this.write((s) => s.delete(id));
  }

  private write(fn: (s: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(PHOTOS, 'readwrite');
      fn(tx.objectStore(PHOTOS));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

class MemoryPhotos implements PhotoStore {
  readonly persistent = false;
  private readonly data = new Map<number, string>();
  async load(): Promise<Map<number, string>> {
    return new Map(this.data);
  }
  async put(id: number, url: string): Promise<void> {
    this.data.set(id, url);
  }
  async remove(id: number): Promise<void> {
    this.data.delete(id);
  }
}

/** 状態と写真の入れ物を開く（使えなければ、保存しない入れ物） */
export async function openStores(): Promise<{ state: StateStore; photos: PhotoStore }> {
  try {
    if (typeof indexedDB === 'undefined') return { state: new MemoryStore(), photos: new MemoryPhotos() };
    const db = await openDb();
    return { state: new IdbStore(db), photos: new IdbPhotos(db) };
  } catch {
    return { state: new MemoryStore(), photos: new MemoryPhotos() };
  }
}

export function memoryPhotos(): PhotoStore {
  return new MemoryPhotos();
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
