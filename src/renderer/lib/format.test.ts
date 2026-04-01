import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatFileSize,
  formatTelegramUnreadBadge,
  safeLabel,
} from './format';

describe('formatDuration', () => {
  it('formats minute-second values', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('formats hour values', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('formatFileSize', () => {
  it('returns undefined for empty sizes', () => {
    expect(formatFileSize(0)).toBeUndefined();
  });

  it('formats kilobytes and megabytes', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('formatTelegramUnreadBadge', () => {
  it('caps large counts at 99+', () => {
    expect(formatTelegramUnreadBadge(120)).toBe('99+');
  });
});

describe('safeLabel', () => {
  it('falls back when the label is blank', () => {
    expect(safeLabel('   ', 'Fallback')).toBe('Fallback');
  });
});
