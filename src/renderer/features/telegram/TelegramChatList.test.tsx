import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { installDom } from '../../test/dom';
import { formatChatTimestamp } from '../../lib/format';
import { TelegramChatList } from './TelegramChatList';

describe('TelegramChatList', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    window.pelec = {
      getAppCacheSize: vi.fn().mockResolvedValue(24 * 1024 * 1024),
      getConnectorProfile: vi.fn().mockResolvedValue({
        displayName: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: 'ada',
        avatarUrl: undefined,
      }),
      updateConnectorProfile: vi.fn().mockResolvedValue({
        displayName: 'Ada Byron',
        firstName: 'Ada',
        lastName: 'Byron',
        username: 'ada_byron',
        avatarUrl: undefined,
      }),
    } as unknown as typeof window.pelec;
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders chats and routes search and selection actions', () => {
    const onSelectChat = vi.fn();
    const timestamp = Date.now();
    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[
          {
            id: 'chat-1',
            title: 'Ops',
            lastMessageSender: 'Ada',
            lastMessagePreview: 'Deploy done',
            lastMessageTimestamp: timestamp,
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
    expect(view.container.textContent).toContain('Ada:');
    expect(view.container.querySelector('.telegram-chat-date')?.textContent).toBe(
      formatChatTimestamp(timestamp),
    );
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

  it('scrolls the selected chat into view when selection changes', () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const view = render(
        <TelegramChatList
          activeChatId="chat-1"
          chats={[
            {
              id: 'chat-1',
              title: 'Ops',
              lastMessagePreview: 'Deploy done',
              unreadCount: 0,
              avatarUrl: undefined,
            },
            {
              id: 'chat-2',
              title: 'Infra',
              lastMessagePreview: 'Deploy queued',
              unreadCount: 0,
              avatarUrl: undefined,
            },
          ]}
          loadError={null}
          loading={false}
          onSearchQueryChange={() => undefined}
          onSelectChat={() => undefined}
          searchQuery=""
          selectedChatId="chat-1"
        />,
      );

      scrollIntoView.mockClear();

      view.rerender(
        <TelegramChatList
          activeChatId="chat-1"
          chats={[
            {
              id: 'chat-1',
              title: 'Ops',
              lastMessagePreview: 'Deploy done',
              unreadCount: 0,
              avatarUrl: undefined,
            },
            {
              id: 'chat-2',
              title: 'Infra',
              lastMessagePreview: 'Deploy queued',
              unreadCount: 0,
              avatarUrl: undefined,
            },
          ]}
          loadError={null}
          loading={false}
          onSearchQueryChange={() => undefined}
          onSelectChat={() => undefined}
          searchQuery=""
          selectedChatId="chat-2"
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it('shows a plain empty state when there are no chats and no search query', () => {
    const view = render(
      <TelegramChatList
        activeChatId={null}
        chats={[]}
        loadError={null}
        loading={false}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery=""
        selectedChatId={null}
      />,
    );

    expect(view.container.textContent).toContain('No chats yet.');
    expect(view.container.textContent).not.toContain('No chats match your search.');
  });

  it('does not render a read-status dot for chats with no unread messages', () => {
    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[
          {
            id: 'chat-1',
            title: 'Ops',
            lastMessagePreview: 'Deploy done',
            unreadCount: 0,
            avatarUrl: undefined,
          },
        ]}
        loadError={null}
        loading={false}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    expect(view.container.querySelector('.telegram-chat-read-dot')).toBeNull();
    expect(view.container.querySelector('.telegram-chat-unread-badge')).toBeNull();
  });

  it('renders outgoing read receipts when the latest message is from me', () => {
    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[
          {
            id: 'chat-1',
            title: 'Ops',
            lastMessagePreview: 'Deploy done',
            lastMessageOutgoing: true,
            lastMessageReadByPeer: true,
            unreadCount: 0,
            avatarUrl: undefined,
          },
        ]}
        loadError={null}
        loading={false}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    expect(view.container.querySelector('.telegram-chat-receipt.read')?.getAttribute('title')).toBe('Read');
    expect(view.container.querySelector('.telegram-chat-tick.double')?.textContent).toBe('✓✓');
  });

  it('renders a settings panel next to search and triggers its actions', async () => {
    const onClearCache = vi.fn(async () => undefined);
    const onClearSearch = vi.fn();
    const onOpenConfig = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);

    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[]}
        configPath="/tmp/pelec-config.toml"
        loadError={null}
        loading={false}
        onClearCache={onClearCache}
        onClearSearch={onClearSearch}
        onOpenConfig={onOpenConfig}
        onRefresh={onRefresh}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery="ops"
        selectedChatId="chat-1"
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram settings' }));

    expect(view.getByRole('menu', { name: 'Telegram settings' })).toBeTruthy();
    await waitFor(() => {
      expect(view.container.textContent).toContain('Cache 24.0 MB');
    });

    fireEvent.click(view.getByRole('button', { name: 'Clear Search' }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram settings' }));
    fireEvent.click(view.getByRole('button', { name: 'Clear Cache' }));
    await waitFor(() => expect(onClearCache).toHaveBeenCalledTimes(1));

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram settings' }));
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram settings' }));
    fireEvent.click(view.getByRole('button', { name: 'Open Config' }));
    await waitFor(() => expect(onOpenConfig).toHaveBeenCalledTimes(1));
  });

  it('renders a profile panel to the right of search and moves auth controls into it', async () => {
    const onLogin = vi.fn(async () => undefined);
    const onLogout = vi.fn(async () => undefined);

    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[]}
        loadError={null}
        loading={false}
        onLogin={onLogin}
        onLogout={onLogout}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram profile' }));

    expect(view.getByRole('dialog', { name: 'Telegram profile' })).toBeTruthy();
    await waitFor(() => {
      expect((view.getByRole('textbox', { name: 'First Name' }) as HTMLInputElement).value).toBe('Ada');
      expect((view.getByRole('textbox', { name: 'Last Name' }) as HTMLInputElement).value).toBe('Lovelace');
      expect((view.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('ada');
    });

    fireEvent.input(view.getByRole('textbox', { name: 'Last Name' }), {
      target: { value: 'Byron' },
    });
    fireEvent.input(view.getByRole('textbox', { name: 'Username' }), {
      target: { value: '@ada_byron' },
    });
    await waitFor(() => {
      expect((view.getByRole('textbox', { name: 'Last Name' }) as HTMLInputElement).value).toBe('Byron');
      expect((view.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('@ada_byron');
    });
    fireEvent.click(view.getByRole('button', { name: 'Save Profile' }));

    await waitFor(() => {
      expect(window.pelec.updateConnectorProfile).toHaveBeenCalledWith('telegram', {
        firstName: 'Ada',
        lastName: 'Byron',
        username: 'ada_byron',
        avatarDataUrl: undefined,
        avatarFileName: undefined,
      });
    });

    fireEvent.click(view.getByRole('button', { name: 'Log In' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram profile' }));
    fireEvent.click(view.getByRole('button', { name: 'Log Out' }));
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it('formats large cache sizes in gigabytes', async () => {
    window.pelec.getAppCacheSize = vi.fn().mockResolvedValue(2.5 * 1024 * 1024 * 1024);

    const view = render(
      <TelegramChatList
        activeChatId="chat-1"
        chats={[]}
        loadError={null}
        loading={false}
        onSearchQueryChange={() => undefined}
        onSelectChat={() => undefined}
        searchQuery=""
        selectedChatId="chat-1"
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Open Telegram settings' }));

    await waitFor(() => {
      expect(view.container.textContent).toContain('Cache 2.50 GB');
    });
  });
});
