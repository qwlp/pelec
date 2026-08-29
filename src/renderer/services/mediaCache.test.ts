import { describe, expect, it, vi } from 'vitest';
import { AsyncLruCache } from './mediaCache';

describe('AsyncLruCache', () => {
  it('dedupes concurrent loads for the same key', async () => {
    const cache = new AsyncLruCache<string>(2);
    const load = vi.fn(async () => 'value');

    const [first, second] = await Promise.all([cache.get('a', load), cache.get('a', load)]);

    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry', async () => {
    const cache = new AsyncLruCache<string>(2);

    await cache.get('a', async () => 'A');
    await cache.get('b', async () => 'B');
    await cache.get('a', async () => 'A2');
    await cache.get('c', async () => 'C');

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('caches undefined values as valid results', async () => {
    const cache = new AsyncLruCache<string | undefined>(2);
    const load = vi.fn(async () => undefined);

    const first = await cache.get('missing', load);
    const second = await cache.get('missing', load);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
