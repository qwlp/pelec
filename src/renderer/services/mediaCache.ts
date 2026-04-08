export class AsyncLruCache<T> {
  private readonly maxEntries: number;

  private readonly values = new Map<string, T>();

  private readonly pending = new Map<string, Promise<T>>();

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  clear(): void {
    this.values.clear();
    this.pending.clear();
  }

  delete(key: string): void {
    this.values.delete(key);
    this.pending.delete(key);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  peek(key: string): T | undefined {
    return this.values.get(key);
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.values.has(key)) {
      const cached = this.values.get(key) as T;
      this.touch(key, cached);
      return cached;
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const nextPromise = load()
      .then((value) => {
        this.pending.delete(key);
        this.touch(key, value);
        return value;
      })
      .catch((error) => {
        this.pending.delete(key);
        throw error;
      });

    this.pending.set(key, nextPromise);
    return nextPromise;
  }

  private touch(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);

    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.values.delete(oldestKey);
    }
  }
}
