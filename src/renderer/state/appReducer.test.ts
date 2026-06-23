import { describe, expect, it } from 'vitest';
import type { LegacyAppSnapshot } from '../legacyBridge';
import { appReducer, initialAppState } from './appReducer';

describe('appReducer', () => {
  const buildLegacySnapshot = (): LegacyAppSnapshot => ({
    authPrompt: null,
    mode: 'insert' as const,
    activeNetwork: 'telegram' as const,
    activePane: 'telegram-messages' as const,
    qrAuth: null,
    telegram: {
      activeChatTitle: 'Telegram',
      activeChatId: 'chat-1',
      activeChatCanSend: true,
      chatListMinimized: false,
      contextMenu: {
        messageId: null,
        visible: false,
        x: 0,
        y: 0,
      },
      draftText: '',
      filteredChats: [
        {
          id: 'chat-1',
          title: 'Ops',
          lastMessagePreview: 'Hello',
          lastMessageTimestamp: 1,
          unreadCount: 0,
        },
      ],
      forward: {
        candidates: [],
        query: '',
        sending: false,
        visible: false,
      },
      hasOlderMessages: false,
      imagePreviewMeta: null,
      imagePreviewUrl: null,
      loadError: null,
      loadingOlderMessages: false,
      loading: false,
      messageLoadError: null,
      messages: [
        {
          id: '1',
          sender: 'Ada',
          text: 'Hello',
          timestamp: 1,
        },
      ],
      messagesLoading: false,
      pendingAttachments: [],
      replyToMessageId: null,
      replyPreview: null,
      searchQuery: '',
      selectedChatId: 'chat-1',
      selectedMessageId: '1',
      voiceRecorderState: 'idle' as const,
    },
  });

  it('switches display mode to command when the palette opens', () => {
    const next = appReducer(initialAppState, { type: 'commandPalette/open' });

    expect(next.commandPalette.isOpen).toBe(true);
    expect(next.appShell.mode).toBe('command');
  });

  it('hydrates legacy snapshot into shell state', () => {
    const next = appReducer(initialAppState, {
      type: 'legacy/snapshot',
      snapshot: buildLegacySnapshot(),
    });

    expect(next.appShell.activeNetwork).toBe('telegram');
    expect(next.appShell.activePane).toBe('telegram-messages');
    expect(next.appShell.mode).toBe('insert');
  });

  it('reuses state for value-identical legacy snapshots', () => {
    const first = appReducer(initialAppState, {
      type: 'legacy/snapshot',
      snapshot: buildLegacySnapshot(),
    });

    const second = appReducer(first, {
      type: 'legacy/snapshot',
      snapshot: buildLegacySnapshot(),
    });

    expect(second).toBe(first);
  });
});
