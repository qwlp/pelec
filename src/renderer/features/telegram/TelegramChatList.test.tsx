import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { installDom } from '../../test/dom';
import { TelegramChatList } from './TelegramChatList';

describe('TelegramChatList', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders chats and routes search and selection actions', () => {
    const onSelectChat = vi.fn();
    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[
          {
            id: 'chat-1',
            title: 'Ops',
            lastMessagePreview: 'Deploy done',
            unreadCount: 2,
            avatarUrl: undefined,
          },
        ]}
        loadError={null}
        loading={false}
        onSearchQueryChange={() => undefined}
        onSelectChat={onSelectChat}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    fireEvent.click(view.getByRole('button', { name: /ops/i }));

    expect(onSelectChat).toHaveBeenCalledWith('chat-1');
    expect(view.container.textContent).toContain('Deploy done');
    expect((view.getByPlaceholderText('Search') as HTMLInputElement).value).toBe('');
  });

  it('exposes the visible chat list as a focus target', () => {
    const listRef = { current: null as HTMLElement | null };
    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[]}
        listRef={listRef}
        loadError={null}
        loading={false}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    const chatList = view.container.querySelector<HTMLElement>('.telegram-chat-list');

    expect(chatList?.tabIndex).toBe(-1);
    expect(listRef.current).toBe(chatList);
  });
});
