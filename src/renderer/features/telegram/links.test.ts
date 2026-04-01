import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLinkedTextNodes } from './links';
import { installDom } from '../../test/dom';

describe('buildLinkedTextNodes', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    window.pelec = {
      openExternal: vi.fn().mockResolvedValue(true),
    } as unknown as typeof window.pelec;
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('wraps supported links and preserves trailing punctuation', () => {
    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('See www.example.com, please.'));

    const link = host.querySelector('a');
    expect(link?.textContent).toBe('www.example.com');
    expect(link?.getAttribute('href')).toBe('https://www.example.com');
    expect(host.textContent).toBe('See www.example.com, please.');
  });

  it('opens links through the preload bridge instead of direct navigation', () => {
    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('https://pelec.test'));

    const link = host.querySelector('a');
    expect(link).not.toBeNull();

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(window.pelec.openExternal).toHaveBeenCalledWith('https://pelec.test');
  });
});
