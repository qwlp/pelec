import { describe, expect, it } from 'vitest';
import {
  decodeCallEngineMessages,
  encodeCallEngineMessage,
} from './callEngine';

describe('Telegram call engine framing', () => {
  it('round-trips multiple length-prefixed messages and preserves partial data', () => {
    const first = encodeCallEngineMessage({ id: '1', command: 'getInfo' });
    const second = encodeCallEngineMessage({ event: { type: 'metrics', metrics: { signalBars: 4 } } });
    const combined = Buffer.concat([first, second]);
    const split = combined.subarray(0, combined.byteLength - 3);

    const partial = decodeCallEngineMessages(split);
    expect(partial.messages).toEqual([{ id: '1', command: 'getInfo' }]);
    expect(partial.remainder.byteLength).toBeGreaterThan(0);

    const completed = decodeCallEngineMessages(
      Buffer.concat([partial.remainder, combined.subarray(combined.byteLength - 3)]),
    );
    expect(completed.messages).toEqual([
      { event: { type: 'metrics', metrics: { signalBars: 4 } } },
    ]);
    expect(completed.remainder.byteLength).toBe(0);
  });

  it('rejects oversized frames before allocating a payload', () => {
    const frame = Buffer.alloc(4);
    frame.writeUInt32BE(1024 * 1024 + 1);
    expect(() => decodeCallEngineMessages(frame)).toThrow(/oversized/i);
  });
});
