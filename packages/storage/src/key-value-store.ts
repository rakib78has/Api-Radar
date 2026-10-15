/**
 * The subset of `chrome.storage.StorageArea` the repositories need. Keeping
 * it this small lets tests and the Playwright runner use an in-memory store.
 */
export interface KeyValueStore {
  get(keys: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  set(items: Readonly<Record<string, unknown>>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

/**
 * In-memory store. Values are copied through JSON on the way in and out,
 * like chrome.storage, so callers cannot mutate stored data by reference.
 */
export class MemoryStore implements KeyValueStore {
  readonly #items = new Map<string, string>();

  get(keys: readonly string[]): Promise<Readonly<Record<string, unknown>>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const text = this.#items.get(key);
      if (text !== undefined) {
        const value: unknown = JSON.parse(text);
        result[key] = value;
      }
    }
    return Promise.resolve(result);
  }

  set(items: Readonly<Record<string, unknown>>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.#items.set(key, JSON.stringify(value));
    }
    return Promise.resolve();
  }

  remove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.#items.delete(key);
    }
    return Promise.resolve();
  }

  /** Keys currently stored, sorted. For tests and diagnostics. */
  keys(): string[] {
    return [...this.#items.keys()].sort();
  }
}
