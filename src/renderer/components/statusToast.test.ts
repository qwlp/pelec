import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderStatusToast } from './statusToast';
import { installDom } from '../test/dom';

describe('renderStatusToast', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('hides the host when there is no activity', () => {
    const host = document.createElement('div');

    renderStatusToast(host, null);

    expect(host.classList.contains('hidden')).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  it('renders progress state and clamps the bar width', () => {
    const host = document.createElement('div');

    renderStatusToast(host, {
      id: 'sync',
      label: 'Syncing chats',
      detail: 'Refreshing Telegram',
      progress: 1.4,
      state: 'running',
    });

    expect(host.classList.contains('hidden')).toBe(false);
    expect(host.querySelector('.status-toast-label')?.textContent).toBe('Syncing chats');
    expect(host.querySelector('.status-toast-value')?.textContent).toBe('100%');
    expect(
      (host.querySelector('.status-toast-bar') as HTMLElement | null)?.style.width,
    ).toBe('100%');
  });
});
