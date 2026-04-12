import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyAppBridgeApi, LegacyAppSnapshot } from '../legacyBridge';
import { installDom } from '../test/dom';
import { useKeyboardBindings } from './useKeyboardBindings';

const buildSnapshot = (
  activeNetwork: LegacyAppSnapshot['activeNetwork'],
): LegacyAppSnapshot => ({
  authPrompt: null,
  mode: 'normal',
  activeNetwork,
  activePane: activeNetwork === 'instagram' ? 'instagram-chats' : 'telegram-chats',
  qrAuth: null,
  instagram: {
    activeChatTitle: 'Instagram',
    activeChatId: null,
    activeChatCanSend: false,
    draftText: '',
    filteredChats: [],
    loadError: null,
    loading: false,
    messageLoadError: null,
    messages: [],
    messagesLoading: false,
    pendingAttachments: [],
    realtimeStatus: 'disconnected',
    replyPreview: null,
    searchQuery: '',
    selectedChatId: null,
    selectedMessageId: null,
  },
  telegram: {
    activeChatTitle: 'Telegram',
    activeChatId: null,
    activeChatCanSend: false,
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
    hasOlderMessages: false,
    imagePreviewUrl: null,
    loadError: null,
    loadingOlderMessages: false,
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
});

const buildLegacyApi = () => {
  let activeNetwork: LegacyAppSnapshot['activeNetwork'] = 'telegram';

  const api: Partial<LegacyAppBridgeApi> = {
    activateNetwork: vi.fn((network: LegacyAppSnapshot['activeNetwork']) => {
      activeNetwork = network;
    }),
    getCommands: vi.fn().mockReturnValue([]),
    getSnapshot: vi.fn(() => buildSnapshot(activeNetwork)),
    handleEscape: vi.fn(),
    subscribe: vi.fn(),
  };

  return api as LegacyAppBridgeApi;
};

const KeyboardHarness = ({ legacyApi }: { legacyApi: LegacyAppBridgeApi }) => {
  useKeyboardBindings({
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
      instagramNetwork: 'Alt+2',
    },
  });

  return <div>keyboard harness</div>;
};

describe('useKeyboardBindings', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('keeps the requested network switch when the window blurs before keyup', async () => {
    const legacyApi = buildLegacyApi();
    const view = render(<KeyboardHarness legacyApi={legacyApi} />);
    const target = view.getByText('keyboard harness');

    fireEvent.keyDown(target, {
      key: '2',
      code: 'Digit2',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, new window.Event('blur'));

    expect(legacyApi.activateNetwork).toHaveBeenCalledTimes(1);
    expect(legacyApi.activateNetwork).toHaveBeenCalledWith('instagram');
    expect(legacyApi.getSnapshot().activeNetwork).toBe('instagram');
    view.unmount();
    await act(() => Promise.resolve());
  });

  it('keeps the network switch after the modifier is released normally', async () => {
    const legacyApi = buildLegacyApi();
    const view = render(<KeyboardHarness legacyApi={legacyApi} />);
    const target = view.getByText('keyboard harness');

    fireEvent.keyDown(target, {
      key: '2',
      code: 'Digit2',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent.keyUp(document, {
      key: 'Alt',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, new window.Event('blur'));

    expect(legacyApi.activateNetwork).toHaveBeenCalledTimes(1);
    expect(legacyApi.activateNetwork).toHaveBeenCalledWith('instagram');
    expect(legacyApi.getSnapshot().activeNetwork).toBe('instagram');
    view.unmount();
    await act(() => Promise.resolve());
  });
});
