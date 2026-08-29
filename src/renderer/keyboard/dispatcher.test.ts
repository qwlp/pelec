import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../test/dom';
import type { KeyboardDispatcherContext, KeyboardDispatcherState } from './dispatcher';
import { dispatchKeyboardEvent } from './dispatcher';

const buildContext = () => {
  const legacyApi = {
    activateNetwork: vi.fn(),
    activateTelegramChat: vi.fn(),
    activateTelegramMessagesPane: vi.fn(),
    activateSelection: vi.fn(),
    appendTelegramFiles: vi.fn(),
    cancelAuthPrompt: vi.fn(),
    cancelTelegramEdit: vi.fn(),
    cancelTelegramVoiceRecording: vi.fn(),
    clearTelegramReply: vi.fn(),
    closeTelegramContextMenu: vi.fn(),
    closeTelegramForwardMenu: vi.fn(),
    closeTelegramImagePreview: vi.fn(),
    closeQrAuth: vi.fn(),
    copyTelegramMessage: vi.fn(),
    copyTelegramMessageImage: vi.fn(),
    copyTelegramImagePreview: vi.fn(),
    deleteSelection: vi.fn(),
    editTelegramMessage: vi.fn(),
    downloadTelegramImagePreview: vi.fn(),
    executeCommand: vi.fn(),
    focusSearch: vi.fn(),
    focusTelegramComposer: vi.fn(),
    forwardTelegramMessageToChat: vi.fn(),
    getCommands: vi.fn().mockReturnValue([]),
    getSnapshot: vi.fn().mockReturnValue({
      authPrompt: null,
      mode: 'normal',
      activeNetwork: 'telegram',
      activePane: 'telegram-chats',
      qrAuth: null,
      telegram: {
        activeChatTitle: 'Telegram',
        activeChatId: 'chat-1',
        activeChatCanSend: true,
        chatListMinimized: false,
        contextMenu: {
          canEdit: false,
          messageId: null,
          reactions: [],
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
        hasOlderMessages: false,
        imagePreviewUrl: null,
        loadError: null,
        loadingOlderMessages: false,
        loading: false,
        messageLoadError: null,
        messages: [],
        messagesLoading: false,
        pendingAttachments: [],
        editing: {
          messageId: null,
          originalText: '',
        },
        replyToMessageId: null,
        replyPreview: null,
        searchQuery: '',
        selectedChatId: 'chat-1',
        selectedMessageId: null,
        voiceRecorderState: 'idle',
      },
    }),
    handleEscape: vi.fn(),
    loadOlderTelegramMessages: vi.fn(),
    movePane: vi.fn(),
    moveSelection: vi.fn(),
    moveSelectionByPage: vi.fn(),
    moveSelectionToEdge: vi.fn(),
    openBrowser: vi.fn(),
    openTelegramContextMenu: vi.fn(),
    openTelegramForwardMenu: vi.fn(),
    openTelegramImagePreview: vi.fn(),
    refresh: vi.fn(),
    refreshQrAuth: vi.fn(),
    removeTelegramAttachment: vi.fn(),
    setTelegramAttachmentSendAs: vi.fn(),
    setTelegramMessageReaction: vi.fn(),
    revealQrPassword: vi.fn(),
    reply: vi.fn(),
    selectTelegramMessage: vi.fn(),
    sendTelegramMessage: vi.fn(),
    submitAuthPrompt: vi.fn(),
    submitQrPassword: vi.fn(),
    setTelegramForwardQuery: vi.fn(),
    setTelegramDraftValue: vi.fn(),
    setTelegramMessagesVisible: vi.fn(),
    setTelegramSearchQuery: vi.fn(),
    setMode: vi.fn(),
    startTelegramVoiceRecording: vi.fn(),
    startAuth: vi.fn(),
    stopTelegramVoiceRecording: vi.fn(),
    toggleSendBehavior: vi.fn().mockReturnValue('mod-enter'),
    subscribe: vi.fn(),
  };

  const context: KeyboardDispatcherContext = {
    activePane: 'telegram-chats',
    captureInWebview: false,
    closeCommandPalette: vi.fn(),
    closeKeyboardHelp: vi.fn(),
    commandPaletteOpen: false,
    customKeymap: {},
    keyboardHelpOpen: false,
    legacyApi,
    mode: 'normal',
    openCommandPalette: vi.fn(),
    openKeyboardHelp: vi.fn(),
    setMode: vi.fn(),
    shortcuts: {
      forceNormalMode: 'CommandOrControl+[',
      openCommandPalette: 'CommandOrControl+K',
      openKeyboardHelp: 'Shift+/',
      focusSearch: '/',
      nextPane: 'Tab',
      previousPane: 'Shift+Tab',
      telegramNetwork: 'Alt+1',
    },
  };

  return {
    context,
    legacyApi,
    state: {
      pendingSequence: null as string | null,
      pendingSequenceAt: 0,
    } satisfies KeyboardDispatcherState,
  };
};

describe('dispatchKeyboardEvent', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('opens the command palette from the global shortcut', () => {
    const { context, state } = buildContext();
    const event = new window.KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(context.openCommandPalette).toHaveBeenCalled();
  });

  it('routes normal-mode movement through the legacy bridge', () => {
    const { context, legacyApi, state } = buildContext();
    const event = new window.KeyboardEvent('keydown', {
      key: 'j',
      bubbles: true,
      cancelable: true,
    });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(legacyApi.moveSelection).toHaveBeenCalledWith(1);
  });

  it('re-activates the telegram message pane before moving message selection', () => {
    const { context, legacyApi, state } = buildContext();
    context.activePane = 'telegram-messages';
    const event = new window.KeyboardEvent('keydown', {
      key: 'j',
      bubbles: true,
      cancelable: true,
    });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(legacyApi.activateTelegramMessagesPane).toHaveBeenCalledTimes(1);
    expect(legacyApi.moveSelection).toHaveBeenCalledWith(1);
  });

  it('uses the custom move-left handler when provided', () => {
    const { context, legacyApi, state } = buildContext();
    context.onMoveLeft = vi.fn();
    const event = new window.KeyboardEvent('keydown', {
      key: 'h',
      bubbles: true,
      cancelable: true,
    });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(context.onMoveLeft).toHaveBeenCalled();
    expect(legacyApi.movePane).not.toHaveBeenCalled();
  });

  it('uses the custom move-right handler when provided', () => {
    const { context, legacyApi, state } = buildContext();
    context.onMoveRight = vi.fn();
    const event = new window.KeyboardEvent('keydown', {
      key: 'l',
      bubbles: true,
      cancelable: true,
    });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(context.onMoveRight).toHaveBeenCalled();
    expect(legacyApi.movePane).not.toHaveBeenCalled();
  });

  it('uses the custom escape handler before legacy escape', () => {
    const { context, legacyApi, state } = buildContext();
    context.onEscape = vi.fn().mockReturnValue(true);
    const event = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(context.onEscape).toHaveBeenCalledOnce();
    expect(legacyApi.handleEscape).not.toHaveBeenCalled();
  });

  it('uses the custom escape handler while typing', () => {
    const { context, legacyApi, state } = buildContext();
    context.onEscape = vi.fn().mockReturnValue(true);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const event = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: textarea });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(true);
    expect(context.onEscape).toHaveBeenCalledOnce();
    expect(legacyApi.handleEscape).not.toHaveBeenCalled();
  });

  it('does not open keyboard help while typing in an input', () => {
    const { context, state } = buildContext();
    const input = document.createElement('textarea');
    const event = new window.KeyboardEvent('keydown', {
      key: '/',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: input });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(false);
    expect(context.openKeyboardHelp).not.toHaveBeenCalled();
  });

  it('does not open the command palette while typing in an input', () => {
    const { context, state } = buildContext();
    const input = document.createElement('textarea');
    const event = new window.KeyboardEvent('keydown', {
      code: 'KeyK',
      ctrlKey: true,
      key: 'k',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: input });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(false);
    expect(context.openCommandPalette).not.toHaveBeenCalled();
  });

  it('does not switch networks while typing in an input', () => {
    const { context, legacyApi, state } = buildContext();
    const input = document.createElement('textarea');
    const event = new window.KeyboardEvent('keydown', {
      key: '1',
      altKey: true,
      code: 'Digit1',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: input });

    const handled = dispatchKeyboardEvent(event, context, state);

    expect(handled).toBe(false);
    expect(legacyApi.activateNetwork).not.toHaveBeenCalled();
  });
});
