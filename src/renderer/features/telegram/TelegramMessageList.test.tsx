import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyAppBridgeApi } from '../../legacyBridge';
import { formatMessageTimestamp } from '../../lib/format';
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
      answerConnectorPoll: vi.fn(),
      addConnectorPollOption: vi.fn(),
      resolveConnectorAudioUrl: vi.fn(),
      resolveConnectorImageUrl: vi.fn(),
      resolveConnectorVideoUrl: vi.fn(),
      copyConnectorDocument: vi.fn(),
      copyTextToClipboard: vi.fn().mockResolvedValue(true),
      downloadConnectorDocument: vi.fn(),
      openConnectorDocument: vi.fn(),
      openPath: vi.fn(),
    } as unknown as typeof window.pelec;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
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

  it('renders telegram service fallback messages as simple event rows', () => {
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
            id: 'create',
            sender: 'DMUC Student Services (@DMUCStudentservices)',
            text: '[messageBasicGroupChatCreate]',
            timestamp: 1,
          },
          {
            id: 'members',
            sender: 'L (@Lj0902)',
            text: 'Members added',
            timestamp: 2,
            serviceEvent: {
              source: 'telegram',
              kind: 'messageChatAddMembers',
              title: 'added a member',
              detail: 'Bruno - Marcom Manager KVL',
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const createMessage = target.querySelector<HTMLElement>('[data-message-id="create"]');
    const membersMessage = target.querySelector<HTMLElement>('[data-message-id="members"]');
    expect(createMessage?.classList.contains('service-event')).toBe(true);
    expect(createMessage?.querySelector('.telegram-service-line')?.textContent).toContain(
      'DMUC Student Services created the group',
    );
    expect(createMessage?.querySelector('.telegram-service-time')?.textContent).toBe(
      formatMessageTimestamp(1),
    );
    expect(createMessage?.querySelector('.telegram-message-footer')).toBeNull();
    expect(createMessage?.textContent).not.toContain('[messageBasicGroupChatCreate]');
    expect(membersMessage?.classList.contains('service-event')).toBe(true);
    expect(membersMessage?.querySelector('.telegram-service-line')?.textContent).toContain(
      'L added Bruno - Marcom Manager KVL',
    );
  });

  it('truncates pathological message text instead of blocking the renderer', () => {
    const target = document.createElement('div');
    document.body.append(target);

    render(
      <TelegramMessageList
        activeChatId="group-42"
        activeChatTitle="Operations"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'oversized-message',
            sender: 'Ada',
            text: 'x'.repeat(100_000),
            timestamp: 100,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.querySelector('.telegram-message-text')?.textContent?.length).toBeLessThan(6_000);
    expect(target.querySelector('.telegram-message-truncated')).toHaveTextContent(
      'Oversized message oversized-message',
    );
  });

  it('downloads oversized images only after the user requests them', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const resolveImage = window.pelec.resolveConnectorImageUrl as ReturnType<typeof vi.fn>;
    resolveImage.mockResolvedValue('pelec-media://local/large-image');

    render(
      <TelegramMessageList
        activeChatId="group-42"
        activeChatTitle="Operations"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'large-image',
            sender: 'Ada',
            text: 'Photo',
            timestamp: 100,
            imageDeferred: true,
            imageSizeBytes: 12 * 1024 * 1024,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(resolveImage).not.toHaveBeenCalled();
    fireEvent.click(target.querySelector('.telegram-deferred-image button') as HTMLButtonElement);
    await waitFor(() => {
      expect(resolveImage).toHaveBeenCalledWith('telegram', 'group-42', 'large-image');
      expect(target.querySelector('img.telegram-message-image')).toHaveAttribute(
        'src',
        'pelec-media://local/large-image',
      );
    });
  });

  it('shows the Telegram image filename when available', () => {
    const target = document.createElement('div');
    document.body.append(target);

    render(
      <TelegramMessageList
        activeChatId="group-42"
        activeChatTitle="Operations"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'large-image',
            sender: 'Ada',
            text: 'Photo',
            timestamp: 100,
            imageDeferred: true,
            imageName: 'invoice-scan.png',
            imageSizeBytes: 12 * 1024 * 1024,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.querySelector('.telegram-deferred-image-copy strong')?.textContent).toBe(
      'invoice-scan.png',
    );
  });

  it('toggles an existing reaction without selecting the media message', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      selectTelegramMessage: vi.fn(),
      setTelegramMessageReaction: vi.fn().mockResolvedValue(true),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: 'photo-1',
            sender: 'Ada',
            text: 'Photo',
            timestamp: 100,
            imageUrl: 'pelec-media://telegram/photo-1',
            reactions: [{ value: '✍', count: 1, chosen: true }],
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    fireEvent.click(target.querySelector('.telegram-message-reaction') as HTMLElement);

    expect(legacyApi.setTelegramMessageReaction).toHaveBeenCalledWith('photo-1', '✍');
    expect(legacyApi.selectTelegramMessage).not.toHaveBeenCalled();
  });

  it('renders reactions from a collapsed album item that is not the primary message', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      selectTelegramMessage: vi.fn(),
      setTelegramMessageReaction: vi.fn().mockResolvedValue(true),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messages={[
          {
            id: 'album-1-a',
            sender: 'Ada',
            text: 'Photo',
            timestamp: 100,
            imageUrl: 'pelec-media://telegram/album-1-a',
            mediaAlbumId: 'album-1',
            reactions: [{ value: '✍', count: 1, chosen: true }],
          },
          {
            id: 'album-1-b',
            sender: 'Ada',
            text: 'Tasks Update',
            timestamp: 101,
            imageUrl: 'pelec-media://telegram/album-1-b',
            mediaAlbumId: 'album-1',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const reaction = target.querySelector('.telegram-message-reaction') as HTMLElement;

    expect(reaction).toHaveTextContent('✍');
    fireEvent.click(reaction);
    expect(legacyApi.setTelegramMessageReaction).toHaveBeenCalledWith('album-1-a', '✍');
    expect(legacyApi.selectTelegramMessage).not.toHaveBeenCalled();
  });

  it('marks single image messages as wide media bubbles', () => {
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
            id: 'photo-wide',
            sender: 'Ada',
            text: 'was this big for me',
            timestamp: 100,
            outgoing: true,
            imageUrl: 'pelec-media://telegram/photo-wide',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const message = target.querySelector<HTMLElement>('[data-message-id="photo-wide"]');
    expect(message).toHaveClass('outgoing', 'has-wide-media', 'has-single-image');
    expect(message?.querySelector('.telegram-message-image')).toBeTruthy();
    expect(message?.textContent).toContain('was this big for me');
  });

  it('does not collapse album ids across different senders or directions', () => {
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
            id: 'album-mixed-incoming',
            sender: 'Ada',
            text: 'Photo',
            timestamp: 100,
            imageUrl: 'pelec-media://telegram/album-mixed-incoming',
            mediaAlbumId: 'album-mixed',
          },
          {
            id: 'album-mixed-outgoing',
            sender: 'You',
            text: 'was this big for me',
            timestamp: 101,
            outgoing: true,
            imageUrl: 'pelec-media://telegram/album-mixed-outgoing',
            mediaAlbumId: 'album-mixed',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.querySelectorAll('[data-message-id]')).toHaveLength(2);
    expect(target.querySelector('[data-message-id="album-mixed-incoming"]')).toHaveClass('incoming');
    expect(target.querySelector('[data-message-id="album-mixed-outgoing"]')).toHaveClass('outgoing');
    expect(target.querySelector('.telegram-message-album')).toBeNull();
  });

  it('automatically copies selected message text without selecting the message', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    scrollContainer.tabIndex = -1;
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);
    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(),
      openTelegramContextMenu: vi.fn(),
      selectTelegramMessage: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messageTextSelectable
        messages={[
          {
            id: '1',
            sender: 'Ada',
            text: 'copy this part',
            timestamp: 1,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const message = target.querySelector<HTMLElement>('[data-message-id="1"]');
    const messageText = target.querySelector<HTMLElement>('.telegram-message-text');
    expect(message).toBeTruthy();
    expect(messageText).toBeTruthy();
    expect(message?.classList.contains('selectable-text')).toBe(true);

    const range = document.createRange();
    range.selectNodeContents(messageText as HTMLElement);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.mouseDown(messageText as HTMLElement);
    fireEvent.mouseUp(messageText as HTMLElement);

    await waitFor(() => {
      expect(window.pelec.copyTextToClipboard).toHaveBeenCalledWith('copy this part');
    });

    const clipboardData = {
      setData: vi.fn(),
    };
    const copyEvent = new window.Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copyEvent, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });
    target.dispatchEvent(copyEvent);

    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    });
    message?.dispatchEvent(contextMenuEvent);

    fireEvent.click(message as HTMLElement);

    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'copy this part');
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(contextMenuEvent.defaultPrevented).toBe(false);
    expect(legacyApi.activateTelegramMessagesPane).not.toHaveBeenCalled();
    expect(legacyApi.openTelegramContextMenu).not.toHaveBeenCalled();
    expect(legacyApi.selectTelegramMessage).not.toHaveBeenCalled();
  });

  it('keeps normal message selection when selectable text mode has no active text selection', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const legacyApi = {
      selectTelegramMessage: vi.fn(),
    } as unknown as LegacyAppBridgeApi;

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={legacyApi}
        loadError={null}
        messageTextSelectable
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

    const message = target.querySelector<HTMLElement>('[data-message-id="1"]');
    window.getSelection()?.removeAllRanges();

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

  it('selects a pressed message before pane activation can jump to the latest message', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    scrollContainer.tabIndex = -1;
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 120,
    });

    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(() => {
        scrollContainer.scrollTop = 900;
      }),
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
            id: 'older-message',
            sender: 'Ada',
            text: 'Read this',
            timestamp: 1,
          },
          {
            id: 'latest-message',
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

    const olderMessage = target.querySelector<HTMLElement>('[data-message-id="older-message"]');
    fireEvent.mouseDown(olderMessage as HTMLElement);

    expect(legacyApi.selectTelegramMessage).toHaveBeenCalledWith('older-message');
    expect(legacyApi.activateTelegramMessagesPane).not.toHaveBeenCalled();
    expect(scrollContainer.scrollTop).toBe(120);
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

  it('opens image previews without activating the message pane on mousedown', () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'telegram-message-list';
    scrollContainer.tabIndex = -1;
    const target = document.createElement('div');
    scrollContainer.append(target);
    document.body.append(scrollContainer);
    const legacyApi = {
      activateTelegramMessagesPane: vi.fn(),
      openTelegramImagePreview: vi.fn(),
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
            id: 'image-1',
            sender: 'Ada',
            text: 'Photo',
            timestamp: 1,
            imageUrl: 'https://example.com/image.png',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const image = target.querySelector<HTMLImageElement>('.telegram-message-image');
    expect(image).toBeTruthy();

    fireEvent.mouseDown(image as HTMLImageElement);
    fireEvent.click(image as HTMLImageElement);

    expect(legacyApi.activateTelegramMessagesPane).not.toHaveBeenCalled();
    expect(legacyApi.selectTelegramMessage).not.toHaveBeenCalled();
    expect(legacyApi.openTelegramImagePreview).toHaveBeenCalledWith(
      'https://example.com/image.png',
      expect.objectContaining({
        sender: 'Ada',
        timestamp: 1,
      }),
    );
    expect(document.activeElement).not.toBe(scrollContainer);
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

  it('renders polls without the default bubble background', () => {
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
            id: 'poll-1',
            sender: 'Ada',
            text: 'Poll: Best editor?',
            timestamp: 1,
            poll: {
              question: 'Best editor?',
              kind: 'regular',
              totalVoterCount: 12,
              options: [
                { text: 'Vim', voterCount: 5, votePercentage: 42 },
                { text: 'Helix', voterCount: 7, votePercentage: 58, chosen: true },
              ],
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.querySelector('.telegram-poll-card')).toBeTruthy();
    expect(target.querySelector('[data-message-id="poll-1"]')?.className).toContain('poll-only');
    expect(target.querySelector('.telegram-message-text')).toBeNull();
    expect(target.textContent).toContain('Best editor?');
    expect(target.textContent).toContain('58%');
    expect(target.textContent).toContain('12 votes');
    expect(target.textContent).not.toContain('58% · 7');
  });

  it('does not render fake zero counts when poll option results are unavailable', () => {
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
            id: 'poll-2',
            sender: 'Ada',
            text: 'Poll: Saturday morning run',
            timestamp: 1,
            poll: {
              question: 'Saturday morning run',
              kind: 'regular',
              isAnonymous: false,
              totalVoterCount: 9,
              options: [
                { text: 'yes', voterCount: 0 },
                { text: 'no', voterCount: 0 },
              ],
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.textContent).toContain('Saturday morning run');
    expect(target.textContent).toContain('9 votes');
    expect(target.textContent).toContain('Vote to see results');
    expect(target.textContent).not.toContain('0% · 0');
  });

  it('answers a single-choice poll when an option is clicked', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    window.pelec.answerConnectorPoll = vi.fn<typeof window.pelec.answerConnectorPoll>().mockResolvedValue(true);

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'poll-3',
            sender: 'Ada',
            text: 'Poll: Saturday morning run',
            timestamp: 1,
            poll: {
              question: 'Saturday morning run',
              kind: 'regular',
              totalVoterCount: 9,
              options: [
                { text: 'yes', voterCount: 0 },
                { text: 'no', voterCount: 0 },
              ],
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const optionButtons = target.querySelectorAll<HTMLButtonElement>('.telegram-poll-option');
    expect(optionButtons).toHaveLength(2);

    fireEvent.click(optionButtons[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(window.pelec.answerConnectorPoll).toHaveBeenCalledWith('telegram', 'chat-1', 'poll-3', [0]);
    });
  });

  it('renders telegram animations as looping media instead of blank messages', () => {
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
            id: 'anim-1',
            sender: 'Ada',
            text: 'GIF/Animation',
            timestamp: 1,
            animationUrl: 'https://example.com/anim.mp4',
            animationMimeType: 'video/mp4',
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const animation = target.querySelector<HTMLVideoElement>('.telegram-message-animation');
    expect(animation).toBeTruthy();
    expect(animation?.getAttribute('src')).toBe('https://example.com/anim.mp4');
    expect(animation?.autoplay).toBe(true);
    expect(animation?.loop).toBe(true);
    expect(target.querySelector('.telegram-message-text')).toBeNull();
  });

  it('renders webm animated stickers as looping video', () => {
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
            id: 'sticker-1',
            sender: 'Ada',
            text: 'Sticker 😀',
            timestamp: 1,
            stickerUrl: 'pelec-media://local/?path=%2Ftmp%2Fsticker.webm',
            stickerEmoji: '😀',
            stickerIsAnimated: true,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const sticker = target.querySelector<HTMLVideoElement>('.telegram-message-sticker-video');
    expect(sticker).toBeTruthy();
    expect(sticker?.getAttribute('src')).toBe('pelec-media://local/?path=%2Ftmp%2Fsticker.webm');
    expect(sticker?.autoplay).toBe(true);
    expect(sticker?.loop).toBe(true);
  });

  it('stages and submits multiple-choice poll answers', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    window.pelec.answerConnectorPoll = vi.fn<typeof window.pelec.answerConnectorPoll>().mockResolvedValue(true);

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'poll-4',
            sender: 'Ada',
            text: 'Poll: Snacks',
            timestamp: 1,
            poll: {
              question: 'Snacks',
              kind: 'regular',
              allowsMultipleAnswers: true,
              options: [
                { text: 'Fruit', voterCount: 0 },
                { text: 'Chips', voterCount: 0 },
                { text: 'Nuts', voterCount: 0, chosen: true },
              ],
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    const optionButtons = target.querySelectorAll<HTMLButtonElement>('.telegram-poll-option');
    fireEvent.click(optionButtons[0] as HTMLButtonElement);
    fireEvent.click(optionButtons[1] as HTMLButtonElement);
    fireEvent.click(target.querySelector('.telegram-poll-action') as HTMLElement);

    await waitFor(() => {
      expect(window.pelec.answerConnectorPoll).toHaveBeenCalledWith('telegram', 'chat-1', 'poll-4', [0, 1, 2]);
    });
  });

  it('adds an option to an extensible poll', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    window.pelec.addConnectorPollOption =
      vi.fn<typeof window.pelec.addConnectorPollOption>().mockResolvedValue(true);

    render(
      <TelegramMessageList
        activeChatId="chat-1"
        activeChatTitle="Ops"
        legacyApi={null}
        loadError={null}
        messages={[
          {
            id: 'poll-extensible',
            sender: 'Ada',
            text: 'Poll: When are we going?',
            timestamp: 1,
            poll: {
              question: 'When are we going?',
              description: 'Pick the best time.',
              kind: 'regular',
              canAddOption: true,
              canSeeResults: false,
              options: [
                { text: 'Friday', voterCount: 0 },
                { text: 'Saturday', voterCount: 0 },
              ],
            },
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    expect(target.textContent).toContain('Pick the best time.');
    expect(target.textContent).toContain('Results hidden');
    fireEvent.click(target.querySelector('.telegram-poll-add-trigger') as HTMLButtonElement);
    const optionInput = target.querySelector('.telegram-poll-add-input') as HTMLTextAreaElement;
    optionInput.value = 'Sunday';
    fireEvent.submit(target.querySelector('.telegram-poll-add-form') as HTMLFormElement);

    await waitFor(() => {
      expect(window.pelec.addConnectorPollOption).toHaveBeenCalledWith(
        'telegram',
        'chat-1',
        'poll-extensible',
        'Sunday',
      );
    });
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

    const speedButton = target.querySelector<HTMLButtonElement>('.telegram-voice-rate');
    expect(speedButton).toBeTruthy();
    expect(speedButton?.textContent).toBe('1x');

    fireEvent.click(speedButton as HTMLButtonElement);

    await waitFor(() => {
      expect(playbackRate).toBe(1.5);
      expect(speedButton?.textContent).toBe('1.5x');
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

  it('jumps to the latest rendered message when the fixed jump button is pressed', async () => {
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
        activeChatId={null}
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

    const jumpButton = await waitFor(() => {
      const button = document.body.querySelector<HTMLButtonElement>('.telegram-jump-latest-button');
      expect(button).toBeTruthy();
      return button as HTMLButtonElement;
    });
    expect(scrollContainer.querySelector('.telegram-jump-latest-button')).toBeNull();

    scrollIntoView.mockClear();
    fireEvent.click(jumpButton);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'end',
      inline: 'nearest',
    });
    expect(scrollContainer.scrollTop).toBe(600);
  });

  it('does not auto-scroll when a new message arrives while reading older messages', async () => {
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

    scrollContainer.scrollTop = 100;
    fireEvent.scroll(scrollContainer);
    scrollHeight = 760;

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
            text: 'New message',
            timestamp: 3,
          },
        ]}
        messagesLoading={false}
        selectedMessageId={null}
        target={target}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scrollContainer.scrollTop).toBe(100);
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
