import { describe, expect, it } from 'vitest';
import { measureSync } from './performance';

describe('performance helpers', () => {
  it('returns the callback result and a non-negative duration', () => {
    const measured = measureSync('test.measure', () => 42);

    expect(measured.result).toBe(42);
    expect(measured.duration).toBeGreaterThanOrEqual(0);
  });
});
