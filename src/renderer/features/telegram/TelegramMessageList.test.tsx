import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyAppBridgeApi } from '../../legacyBridge';
import { installDom } from '../../test/dom';
import { TelegramMessageList } from './TelegramMessageList';

describe('TelegramMessageList', () => {
  let cleanupDom: (() => void) | undefined;
  let originalAudioPlay: (() => Promise<void>) | undefined;
  let originalAudioLoad: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    originalAudioPlay = window.HTMLMediaElement?.prototype.play;
    originalAudioLoad = window.HTMLMediaElement?.prototype.load;
    window.pelec = {
      resolveConnectorAudioUrl: vi.fn(),
      resolveConnectorVideoUrl: vi.fn(),
      copyConnectorDocument: vi.fn(),
      downloadConnectorDocument: vi.fn(),
      openPath: vi.fn(),
    } as unknown as typeof window.pelec;
  });

  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (window.HTMLMediaElement && originalAudioPlay) {
      Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
        configurable: true,
        value: originalAudioPlay,
      });
    }
    if (window.HTMLMediaElement && originalAudioLoad) {
      Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
        configurable: true,
        value: originalAudioLoad,
      });
    }
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders into the target portal and selects messages on click', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(),
      selectTelegramMessage: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId="1"
        target={target}
      />,
    );

    const message = target.querySelector<HTMLElement>('[data-message-id="1"]');
    expect(message?.textContent).toContain('Hello');

    fireEvent.click(message as HTMLElement);

    expect(legacyApi.selectTelegramMessage).toHaveBeenCalledWith('1');
  });

  it('activates the telegram messages pane when the chat area is clicked', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    scrollContainer.tabIndex = -1;
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);
    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    fireEvent.mouseDown(target);

    expect(legacyApi.activateTelegramMessagesPane).toHaveBeenCalled();
    expect(document.activeElement).toBe(scrollContainer);
  });

  it('activates the telegram messages pane when the message list surface is clicked', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    scrollContainer.tabIndex = -1;
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);
    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    fireEvent.mouseDown(scrollContainer);

    expect(legacyApi.activateTelegramMessagesPane).toHaveBeenCalled();
    expect(document.activeElement).toBe(scrollContainer);
  });

  it('accepts dropped files anywhere in the message pane', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);
    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(),
      appendTelegramFiles: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        canDropFiles
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const dragData = {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file' }],
        dropEffect: 'none',
      },
    };

    fireEvent.dragEnter(scrollContainer, dragData);
    expect(scrollContainer.querySelector('.telegram-message-drop-target')).toBeTruthy();

    fireEvent.drop(scrollContainer, dragData);
    expect(legacyApi.appendTelegramFiles).toHaveBeenCalledWith([file]);
  });

  it('renders voice notes and calls with the migrated legacy class structure', () => {
    const target = document.createElement('div');
    document.body.append(target);

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'voice-1',
            sender: 'Ada',
            text: 'Voice message',
            timestamp: 1,
            hasAudio: true,
            audioDurationSeconds: 1,
          },
          {
            id: 'call-1',
            sender: 'Ada',
            text: '',
            timestamp: 2,
            call: {
              durationSeconds: 5,
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.querySelector('.telegram-voice-note')).toBeTruthy();
    expect(target.querySelector('.telegram-call-card')).toBeTruthy();
    expect(target.textContent).toContain('Voice call');
    expect(target.textContent).toContain('Duration 0:05');
  });

  it('renders sender avatars in message headers when available', () => {
    const target = document.createElement('div');
    document.body.append(target);

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Chestnuts',
            senderAvatarUrl: 'https://example.com/chestnuts.png',
            text: 'Hello',
            timestamp: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const avatarImage = target.querySelector<HTMLImageElement>('.telegram-message-header .telegram-avatar img');
    expect(avatarImage?.getAttribute('src')).toBe('https://example.com/chestnuts.png');
    expect(target.querySelector('.telegram-message-header .telegram-avatar.fallback')).toBeNull();
  });

  it('starts voice-note playback on the first click after resolving the audio url', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const play = vi.fn(() => Promise.resolve());
    const load = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: play,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value: load,
    });
    const resolveConnectorAudioUrl = vi
      .fn<typeof window.pelec.resolveConnectorAudioUrl>()
      .mockResolvedValue('https://example.com/voice-note.ogg');
    window.pelec.resolveConnectorAudioUrl = resolveConnectorAudioUrl;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'voice-1',
            sender: 'Ada',
            text: 'Voice message',
            timestamp: 1,
            hasAudio: true,
            audioDurationSeconds: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const playButton = target.querySelector<HTMLButtonElement>('.telegram-voice-play');
    expect(playButton).toBeTruthy();

    fireEvent.click(playButton as HTMLButtonElement);

    await waitFor(() => {
      expect(resolveConnectorAudioUrl).toHaveBeenCalledWith('telegram', 'chat-1', 'voice-1');
      expect(load).toHaveBeenCalled();
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it('renders album videos with the album player after resolving the video url', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const play = vi.fn(() => Promise.resolve());
    const load = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: play,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value: load,
    });
    const resolveConnectorVideoUrl = vi
      .fn<typeof window.pelec.resolveConnectorVideoUrl>()
      .mockResolvedValue('pelec-media://local/?path=%2Ftmp%2Fclip.mp4');
    window.pelec.resolveConnectorVideoUrl = resolveConnectorVideoUrl;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'video-1',
            sender: 'Ada',
            text: 'Video',
            timestamp: 1,
            hasVideo: true,
            mediaAlbumId: 'album-1',
          },
          {
            id: 'image-1',
            sender: 'Ada',
            text: '',
            timestamp: 2,
            imageUrl: 'https://example.com/image.png',
            mediaAlbumId: 'album-1',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const playButton = target.querySelector<HTMLButtonElement>('.telegram-message-album-video-shell .telegram-message-video-trigger');
    expect(playButton).toBeTruthy();

    fireEvent.click(playButton as HTMLButtonElement);

    await waitFor(() => {
      expect(resolveConnectorVideoUrl).toHaveBeenCalledWith('telegram', 'chat-1', 'video-1');
      expect(target.querySelector('.telegram-message-album-video')).toBeTruthy();
      expect(load).toHaveBeenCalled();
      expect(play).toHaveBeenCalledTimes(1);
    });
  });

  it('jumps to the latest rendered message when the jump button is pressed', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
          {
            id: '2',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 2,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    fireEvent.scroll(scrollContainer);

    const latestMessage = target.querySelector<HTMLElement>('[data-message-id="2"]');
    const scrollIntoView = vi.fn();
    Object.defineProperty(latestMessage as HTMLElement, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    const jumpButton = scrollContainer.querySelector<HTMLButtonElement>('.telegram-jump-latest-button');
    expect(jumpButton).toBeTruthy();

    fireEvent.click(jumpButton as HTMLButtonElement);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'end',
      inline: 'nearest',
    });
    expect(scrollContainer.scrollTop).toBe(600);
  });

  it('auto-scrolls to the bottom after a chat click reload completes', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    const { rerender } = render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
          {
            id: '2',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 2,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    rerender(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[]}
        messagesLoading={true}
        selectedMessageId={null}
        target={target}
      />,
    );

    rerender(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
          {
            id: '2',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 2,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(600);
    });
  });

  it('keeps auto-scrolling during the follow-up hydration pass after opening a chat', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    const { rerender } = render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
          {
            id: '2',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 2,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(600);
    });

    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    scrollContainer.scrollTop = 0;

    rerender(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 1,
          },
          {
            id: '2',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 2,
          },
          {
            id: '3',
            sender: 'Grace',
            text: 'Hydrated latest',
            timestamp: 3,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(900);
    });
  });

  it('does not scroll a reused selected message into view when switching chats', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const { rerender } = render(
        <TelegramMessageList
          activeChatId="chat-1"
          activeChatTitle="Ops"
          legacyApi={null}
          loadError={null}
          messages={[
            {
              id: '1',
              sender: 'Ada',
              text: 'First',
              timestamp: 1,
            },
            {
              id: '2',
              sender: 'Linus',
              text: 'Latest',
              timestamp: 2,
            },
          ]}
          messagesLoading={false}
          selectedMessageId="2"
          target={target}
        />,
      );

      scrollIntoView.mockClear();

      rerender(
        <TelegramMessageList
          activeChatId="chat-2"
          activeChatTitle="Ops 2"
          legacyApi={null}
          loadError={null}
          messages={[
            {
              id: '1',
              sender: 'Ada',
              text: 'Top message',
              timestamp: 1,
            },
            {
              id: '2',
              sender: 'Grace',
              text: 'Bottom message',
              timestamp: 2,
            },
          ]}
          messagesLoading={false}
          selectedMessageId="1"
          target={target}
        />,
      );

      await waitFor(() => {
        expect(scrollContainer.scrollTop).toBe(600);
      });
      expect(scrollIntoView).not.toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });
});
