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

  it('renders a compact running state without progress chrome', () => {
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
    expect(host.querySelector('.status-toast-icon')).not.toBeNull();
    expect(host.querySelector('.status-toast-detail')).toBeNull();
    expect(host.querySelector('.status-toast-bar')).toBeNull();
  });

  it('only renders detail copy for errors', () => {
    const host = document.createElement('div');

    renderStatusToast(host, {
      id: 'open',
      label: 'Open failed',
      detail: 'Could not open file.pdf.',
      state: 'error',
    });

    expect(host.querySelector('.status-toast-label')?.textContent).toBe('Open failed');
    expect(host.querySelector('.status-toast-detail')?.textContent).toBe('Could not open file.pdf.');
  });
});
