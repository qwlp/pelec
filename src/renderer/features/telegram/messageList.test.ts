import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../shared/connectors';
import { installDom } from '../../test/dom';
import { replaceTelegramMessageText, syncTelegramMessageListNodes } from './messageList';

describe('telegram message updates', () => {
  it('replaces the edited message without mutating the existing snapshot', () => {
    const originalMessage: ChatMessage = {
      id: 'message-1',
      sender: 'You',
      text: 'before',
      textEntities: [{ offset: 0, length: 6, type: 'bold' }],
      timestamp: 1,
    };
    const messages = [originalMessage];

    const nextMessages = replaceTelegramMessageText(messages, 'message-1', 'after');

    expect(nextMessages).not.toBe(messages);
    expect(nextMessages[0]).not.toBe(originalMessage);
    expect(nextMessages[0]).toMatchObject({
      id: 'message-1',
      text: 'after',
      textEntities: undefined,
    });
    expect(originalMessage.text).toBe('before');
  });

  it('reuses the message list when the edited message is not loaded', () => {
    const messages = [{ id: 'message-1', sender: 'You', text: 'before', timestamp: 1 }];

    expect(replaceTelegramMessageText(messages, 'missing', 'after')).toBe(messages);
  });
});

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
