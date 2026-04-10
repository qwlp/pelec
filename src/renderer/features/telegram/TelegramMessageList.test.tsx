import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyAppBridgeApi } from '../../legacyBridge';
import { installDom } from '../../test/dom';
import { TelegramMessageList } from './TelegramMessageList';

describe('TelegramMessageList', () => {
  let cleanupDom: (() => void) | undefined;
  let originalAudioPlay: (() => Promise<void>) | undefined;
  let originalAudioLoad: (() => void) | undefined;
  let originalAudioPause: (() => void) | undefined;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    originalAudioPlay = window.HTMLMediaElement?.prototype.play;
    originalAudioLoad = window.HTMLMediaElement?.prototype.load;
    originalAudioPause = window.HTMLMediaElement?.prototype.pause;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
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
    if (window.HTMLMediaElement && originalAudioPause) {
      Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
        configurable: true,
        value: originalAudioPause,
      });
    }
    if (originalRequestAnimationFrame) {
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
    } else {
      delete (window as Partial<typeof window>).requestAnimationFrame;
      delete (globalThis as Partial<typeof globalThis>).requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
      Object.defineProperty(globalThis, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
    } else {
      delete (window as Partial<typeof window>).cancelAnimationFrame;
      delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
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

  it('renders a compact back action and routes it to the provided handler', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onBackToChats = vi.fn();

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[]}
        messagesLoading={false}
        onBackToChats={onBackToChats}
        selectedMessageId={null}
        target={target}
      />,
    );

    fireEvent.click(document.body.querySelector('.telegram-message-back-button') as HTMLElement);

    expect(target.textContent).toContain('Back to chats');
    expect(onBackToChats).toHaveBeenCalledTimes(1);
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

  it('pauses the current voice note before starting another one', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: play,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pause,
    });

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
            audioUrl: 'https://example.com/voice-1.ogg',
          },
          {
            id: 'voice-2',
            sender: 'Linus',
            text: 'Voice message',
            timestamp: 2,
            hasAudio: true,
            audioUrl: 'https://example.com/voice-2.ogg',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const playButtons = target.querySelectorAll<HTMLButtonElement>('.telegram-voice-play');
    expect(playButtons).toHaveLength(2);

    fireEvent.click(playButtons[0] as HTMLButtonElement);
    fireEvent.click(playButtons[1] as HTMLButtonElement);

    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not autoplay an older pending voice note after a newer one starts', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const load = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: play,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pause,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value: load,
    });

    let resolveFirstAudioUrl: ((value: string | null) => void) | null = null;
    window.pelec.resolveConnectorAudioUrl = vi
      .fn<typeof window.pelec.resolveConnectorAudioUrl>()
      .mockImplementation(
        (_network: string, _chatId: string, messageId: string): Promise<string | null> =>
          new Promise((resolve) => {
            if (messageId === 'voice-1') {
              resolveFirstAudioUrl = resolve;
              return;
            }
            resolve(`https://example.com/${messageId}.ogg`);
          }),
      );

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
          },
          {
            id: 'voice-2',
            sender: 'Linus',
            text: 'Voice message',
            timestamp: 2,
            hasAudio: true,
            audioUrl: 'https://example.com/voice-2.ogg',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const playButtons = target.querySelectorAll<HTMLButtonElement>('.telegram-voice-play');
    expect(playButtons).toHaveLength(2);

    fireEvent.click(playButtons[0] as HTMLButtonElement);
    await waitFor(() => {
      expect(window.pelec.resolveConnectorAudioUrl).toHaveBeenCalledWith('telegram', 'chat-1', 'voice-1');
    });

    fireEvent.click(playButtons[1] as HTMLButtonElement);
    expect(play).toHaveBeenCalledTimes(1);

    resolveFirstAudioUrl?.('https://example.com/voice-1.ogg');

    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1);
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('updates voice-note progress from animation frames between media events', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const load = vi.fn();
    const pause = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value: load,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: pause,
    });
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        rafCallbacks.set(frameId, callback);
        return frameId;
      },
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: window.requestAnimationFrame,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (frameId: number) => {
        rafCallbacks.delete(frameId);
      },
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: window.cancelAnimationFrame,
    });

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
            audioUrl: 'https://example.com/voice-1.ogg',
            audioDurationSeconds: 10,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const audio = target.querySelector<HTMLAudioElement>('.telegram-message-audio');
    expect(audio).toBeTruthy();

    let currentTime = 0;
    let paused = true;
    Object.defineProperty(audio as HTMLAudioElement, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(audio as HTMLAudioElement, 'paused', {
      configurable: true,
      get: () => paused,
    });
    Object.defineProperty(audio as HTMLAudioElement, 'ended', {
      configurable: true,
      get: () => false,
    });

    rafCallbacks.clear();
    paused = false;
    fireEvent.play(audio as HTMLAudioElement);

    currentTime = 5;
    const firstFrame = Array.from(rafCallbacks.values()).at(-1);
    expect(firstFrame).toBeTruthy();
    act(() => {
      firstFrame?.(16);
    });

    await waitFor(() => {
      expect(target.querySelectorAll('.telegram-voice-wave-bar.is-played').length).toBeGreaterThan(10);
    });
  });

  it('seeks within the voice waveform and updates the time readout', async () => {
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
            audioUrl: 'https://example.com/voice-1.ogg',
            audioDurationSeconds: 12,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const audio = target.querySelector<HTMLAudioElement>('.telegram-message-audio');
    expect(audio).toBeTruthy();

    let currentTime = 0;
    Object.defineProperty(audio as HTMLAudioElement, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });

    const waveform = target.querySelector<HTMLButtonElement>('.telegram-voice-wave');
    expect(waveform).toBeTruthy();
    Object.defineProperty(waveform as HTMLButtonElement, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          left: 0,
          width: 120,
        }) as DOMRect,
    });

    fireEvent.click(waveform as HTMLButtonElement, { clientX: 60 });

    await waitFor(() => {
      expect(currentTime).toBe(6);
      expect(target.textContent).toContain('0:06 / 0:12');
    });
  });

  it('changes the shared voice-note playback speed from the rate control', async () => {
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
            audioUrl: 'https://example.com/voice-1.ogg',
            audioDurationSeconds: 12,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const audio = target.querySelector<HTMLAudioElement>('.telegram-message-audio');
    expect(audio).toBeTruthy();

    let playbackRate = 1;
    Object.defineProperty(audio as HTMLAudioElement, 'playbackRate', {
      configurable: true,
      get: () => playbackRate,
      set: (value: number) => {
        playbackRate = value;
      },
    });

    const speedButton = target.querySelector<HTMLButtonElement>('.telegram-voice-rate[aria-label="Playback speed 1.5x"]');
    expect(speedButton).toBeTruthy();

    fireEvent.click(speedButton as HTMLButtonElement);

    await waitFor(() => {
      expect(playbackRate).toBe(1.5);
      expect(speedButton?.getAttribute('aria-pressed')).toBe('true');
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

  it('loads older messages at the top and preserves scroll position after prepending history', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);

    let scrollHeight = 600;
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    const legacyApi = {
      loadOlderTelegramMessages: vi.fn(async () => undefined),
    } as unknown as LegacyAppBridgeApi;

    const { rerender } = render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        hasOlderMessages
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: '2',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 2,
          },
          {
            id: '3',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 3,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    scrollContainer.scrollTop = 0;
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(legacyApi.loadOlderTelegramMessages).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        hasOlderMessages
        legacyApi={legacyApi}
        loadError={null}
        loadingOlderMessages
        messages={[
          {
            id: '2',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 2,
          },
          {
            id: '3',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 3,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    scrollContainer.scrollTop = 0;
    scrollHeight = 900;
    rerender(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: '0',
            sender: 'Grace',
            text: 'Older',
            timestamp: 0,
          },
          {
            id: '1',
            sender: 'Grace',
            text: 'Earlier',
            timestamp: 1,
          },
          {
            id: '2',
            sender: 'Ada',
            text: 'Hello',
            timestamp: 2,
          },
          {
            id: '3',
            sender: 'Linus',
            text: 'Latest',
            timestamp: 3,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(300);
    });
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
