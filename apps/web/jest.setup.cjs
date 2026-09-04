// Installs a minimal in-memory `localStorage` polyfill before any test
// module loads. Node has no stable global `localStorage`, and
// zustand/middleware's `persist` accesses it synchronously at module-eval
// time (when a persisted store is first imported) — a `beforeEach` in the
// test file itself runs too late to matter.
class FakeLocalStorage {
  constructor() {
    this.store = new Map();
  }
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  key(index) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key) {
    this.store.delete(key);
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
}

global.localStorage = new FakeLocalStorage();
