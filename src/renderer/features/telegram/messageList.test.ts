import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDom } from '../../test/dom';
import { syncTelegramMessageListNodes } from './messageList';

describe('telegram message list sync', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('reorders and reuses existing nodes without replacing them', () => {
    const host = document.createElement('div');
    const first = document.createElement('article');
    first.dataset.id = '1';
    const second = document.createElement('article');
    second.dataset.id = '2';
    const third = document.createElement('article');
    third.dataset.id = '3';
    host.append(first, second, third);

    syncTelegramMessageListNodes(host, [third, first]);

    expect([...host.children]).toEqual([third, first]);
    expect(host.children.item(0)).toBe(third);
    expect(host.children.item(1)).toBe(first);
  });

  it('inserts new nodes at the correct position', () => {
    const host = document.createElement('div');
    const first = document.createElement('article');
    const inserted = document.createElement('article');
    const second = document.createElement('article');
    host.append(first, second);

    syncTelegramMessageListNodes(host, [first, inserted, second]);

    expect([...host.children]).toEqual([first, inserted, second]);
  });
});
