import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from './appReducer';

describe('appReducer', () => {
  it('switches display mode to command when the palette opens', () => {
    const next = appReducer(initialAppState, { type: 'commandPalette/open' });

    expect(next.commandPalette.isOpen).toBe(true);
    expect(next.appShell.mode).toBe('command');
  });

  it('hydrates legacy snapshot into shell state', () => {
    const next = appReducer(initialAppState, {
      type: 'legacy/snapshot',
      snapshot: {
        authPrompt: null,
        mode: 'insert',
        activeNetwork: 'telegram',
        activePane: 'telegram-messages',
        qrAuth: null,
        telegram: {
          activeChatTitle: 'Telegram',
          activeChatId: null,
          chatListMinimized: false,
          contextMenu: {
            messageId: null,
            visible: false,
            x: 0,
            y: 0,
          },
          draftText: '',
          filteredChats: [],
          forward: {
            candidates: [],
            query: '',
            sending: false,
            visible: false,
          },
          imagePreviewUrl: null,
          loadError: null,
          loading: false,
          messageLoadError: null,
          messages: [],
          messagesLoading: false,
          pendingAttachments: [],
          replyPreview: null,
          searchQuery: '',
          selectedChatId: null,
          selectedMessageId: null,
          voiceRecorderState: 'idle',
        },
      },
    });

    expect(next.appShell.activeNetwork).toBe('telegram');
    expect(next.appShell.activePane).toBe('telegram-messages');
    expect(next.appShell.mode).toBe('insert');
  });
});
