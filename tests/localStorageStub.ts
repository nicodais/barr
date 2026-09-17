/**
 * The eight lines of `Map` that let the whole persistence layer be tested in
 * Node. `loadSettings` and `loadProgress` are pure functions of a stored
 * string; this is the only thing standing between them and a test runner.
 */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  /** Set to make every write throw, standing in for Safari private mode. */
  failWrites = false;

  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

/** Installs a fresh store on `globalThis` and hands it back. */
export function installStorage(): MemoryStorage {
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
  return store;
}
