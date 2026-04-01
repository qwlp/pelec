import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkpointInDetails,
  clearInstagramCooldownUntil,
  formatCooldownRemaining,
  getInstagramCheckpointCooldownUntil,
  readInstagramCooldownUntil,
  writeInstagramCooldownUntil,
} from './cooldown';
import { installDom } from '../../test/dom';

describe('instagram cooldown helpers', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('clears invalid persisted values', () => {
    window.localStorage.setItem('pelec.instagramCheckpointCooldownUntil', 'invalid');

    expect(readInstagramCooldownUntil()).toBe(0);
    expect(window.localStorage.getItem('pelec.instagramCheckpointCooldownUntil')).toBeNull();
  });

  it('formats remaining time from the current clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-01T00:00:00.000Z'));

    expect(formatCooldownRemaining(Date.parse('2026-04-01T02:15:00.000Z'))).toBe('2h 15m');
  });

  it('stores and clears the cooldown timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-01T00:00:00.000Z'));

    const until = getInstagramCheckpointCooldownUntil();
    writeInstagramCooldownUntil(until);
    expect(readInstagramCooldownUntil()).toBe(until);

    clearInstagramCooldownUntil();
    expect(readInstagramCooldownUntil()).toBe(0);
  });

  it('detects checkpoint errors case-insensitively', () => {
    expect(checkpointInDetails('Checkpoint required')).toBe(true);
    expect(checkpointInDetails('rate limited')).toBe(false);
  });
});
