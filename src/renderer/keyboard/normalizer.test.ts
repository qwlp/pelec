import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDom } from '../test/dom';
import { matchesBinding, normalizeKeyboardEvent } from './normalizer';

describe('keyboard normalizer', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('detects typing targets and normalizes modifier signatures', () => {
    const input = document.createElement('input');
    const event = new window.KeyboardEvent('keydown', {
      code: 'KeyK',
      key: 'k',
      ctrlKey: true,
    });
    Object.defineProperty(event, 'target', { value: input });

    const normalized = normalizeKeyboardEvent(event);
    expect(normalized.code).toBe('KeyK');
    expect(normalized.isTypingTarget).toBe(true);
    expect(normalized.signature).toBe('Ctrl+k');
    expect(matchesBinding(normalized, 'CommandOrControl+K')).toBe(true);
  });

  it('matches physical digit shortcuts across layout-dependent key output', () => {
    const event = new window.KeyboardEvent('keydown', {
      altKey: true,
      code: 'Digit2',
      key: '@',
    });

    const normalized = normalizeKeyboardEvent(event);

    expect(matchesBinding(normalized, 'Alt+2')).toBe(true);
  });
});
