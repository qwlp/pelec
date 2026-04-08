import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDom } from '../test/dom';
import { resolveKeyboardScope } from './scopes';

describe('resolveKeyboardScope', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('prefers the focused telegram message list over a stale active pane', () => {
    const messageList = document.createElement('div');
    messageList.id = 'telegram-message-list';
    const message = document.createElement('article');
    message.dataset.messageId = '1';
    messageList.append(message);
    document.body.append(messageList);

    expect(resolveKeyboardScope(message, 'telegram-chats', false, false)).toBe('telegramMessages');
  });

  it('prefers the focused telegram chat list over a stale active pane', () => {
    const chatList = document.createElement('section');
    chatList.id = 'telegram-chat-list';
    const chat = document.createElement('button');
    chatList.append(chat);
    document.body.append(chatList);

    expect(resolveKeyboardScope(chat, 'telegram-messages', false, false)).toBe('telegramChats');
  });
});
