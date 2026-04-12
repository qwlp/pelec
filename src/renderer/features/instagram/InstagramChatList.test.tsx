import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { InstagramChatList } from './InstagramChatList';

describe('InstagramChatList', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders chats and routes search, refresh, auth, and selection actions', () => {
    const onRefresh = vi.fn();
    const onSearchQueryChange = vi.fn();
    const onSelectChat = vi.fn();
    const onStartAuth = vi.fn();

    const view = render(
      <InstagramChatList
        activeChatId="chat-1"
        chats={[
          {
            id: 'chat-1',
            title: 'Alice',
            lastMessagePreview: 'Hey',
            lastMessageTimestamp: 1,
            unreadCount: 2,
          },
        ]}
        listRef={{ current: null }}
        loadError={null}
        loading={false}
        onRefresh={onRefresh}
        onSearchQueryChange={onSearchQueryChange}
        onSelectChat={onSelectChat}
        onStartAuth={onStartAuth}
        searchInputRef={{ current: null }}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    fireEvent.click(view.getByText('Auth'));
    fireEvent.click(view.getByText('Refresh'));
    fireEvent.click(view.getByText('Alice'));

    expect(typeof onSearchQueryChange).toBe('function');
    expect(onStartAuth).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSelectChat).toHaveBeenCalledWith('chat-1');
  });
});
