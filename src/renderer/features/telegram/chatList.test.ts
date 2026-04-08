import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../../shared/connectors';
import { installDom } from '../../test/dom';
import { createTelegramChatListItem, getTelegramChatRenderSignature } from './chatList';

describe('telegram chat list helpers', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('builds a stable render signature from user-visible chat fields', () => {
    const chat: ChatSummary = {
      id: '1',
      title: 'Ops',
      lastMessagePreview: 'hello',
      lastMessageTimestamp: 123,
      unreadCount: 2,
      avatarUrl: 'https://example.com/a.png',
      isMuted: false,
    };

    expect(getTelegramChatRenderSignature(chat)).toContain('Ops');
    expect(getTelegramChatRenderSignature({ ...chat, unreadCount: 3 })).not.toBe(
      getTelegramChatRenderSignature(chat),
    );
  });

  it('renders a chat row with unread metadata and click handling', () => {
    const onClick = vi.fn();
    const row = createTelegramChatListItem(
      {
        id: '1',
        title: 'Ops',
        lastMessagePreview: 'hello',
        lastMessageTimestamp: 123,
        unreadCount: 2,
        avatarUrl: undefined,
      },
      {
        createAvatarNode: (label) => {
          const node = document.createElement('div');
          node.textContent = label;
          return node;
        },
        formatChatTimestamp: () => '10:00',
        formatFullDateTime: () => 'yesterday',
        formatTelegramUnreadBadge: (count) => String(count),
        hasValidTimestamp: () => true,
        onClick,
        safeLabel: (value, fallback) => value ?? fallback,
        safeText: (value) => value ?? '',
      },
    );

    row.click();

    expect(row.querySelector('.telegram-chat-name')?.textContent).toBe('Ops');
    expect(row.querySelector('.telegram-chat-unread-badge')?.textContent).toBe('2');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
