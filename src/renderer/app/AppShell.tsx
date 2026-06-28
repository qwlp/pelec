import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AppActivity, ShortcutConfig, UserConfig } from '../../shared/types';
import { useKeyboardBindings } from '../keyboard/useKeyboardBindings';
import type { LegacyAppBridgeApi } from '../legacyBridge';
import { applyUserTheme } from '../lib/theme';
import type { CommandPaletteItem } from '../features/commandPalette/CommandPalette';
import { TelegramChatList } from '../features/telegram/TelegramChatList';
import { TelegramCallLayer } from '../features/telegram/TelegramCallLayer';
import { AboutDialog, SettingsDialog } from '../features/settings/SettingsDialog';
import { TelegramComposer, type TelegramMentionSuggestion } from '../features/telegram/TelegramComposer';
import { TelegramConversationErrorBoundary } from '../features/telegram/TelegramConversationErrorBoundary';
import { TelegramMessageList } from '../features/telegram/TelegramMessageList';
import { loadRendererBootstrapData } from '../services/connectors';
import { beginMeasure } from '../services/performance';
import { configLoaded, legacyCommandsChanged, legacyReady, legacySnapshotChanged } from '../state/actions';
import { useAppDispatch, useAppState } from '../state/appStore';
import { selectCommandPaletteItems, selectLegacyTelegramSnapshot } from '../state/selectors';
import { LegacyWorkspaceAdapter } from './LegacyWorkspaceAdapter';
import { ModalLayer } from './ModalLayer';
import { StatusLayer } from './StatusLayer';
import { WebviewHost } from './WebviewHost';

const TELEGRAM_COMPACT_BREAKPOINT_PX = 820;
const IMAGE_ACTION_TOAST_CLEAR_MS = 2600;
const TELEGRAM_SIDEBAR_DEFAULT_WIDTH_PX = 340;
const TELEGRAM_SIDEBAR_MIN_WIDTH_PX = 260;
const TELEGRAM_CONVERSATION_MIN_WIDTH_PX = 320;
const TELEGRAM_SIDEBAR_MAX_WIDTH_PX = 640;
const TELEGRAM_SIDEBAR_STORAGE_KEY = 'pelec.telegramSidebarWidth';

const getTelegramSidebarBounds = (workspaceWidth: number) => ({
  min: TELEGRAM_SIDEBAR_MIN_WIDTH_PX,
  max: Math.max(
    TELEGRAM_SIDEBAR_MIN_WIDTH_PX,
    Math.min(TELEGRAM_SIDEBAR_MAX_WIDTH_PX, workspaceWidth - TELEGRAM_CONVERSATION_MIN_WIDTH_PX),
  ),
});

const clampTelegramSidebarWidth = (width: number, workspaceWidth: number): number => {
  const bounds = getTelegramSidebarBounds(workspaceWidth);
  return Math.min(bounds.max, Math.max(bounds.min, width));
};

const readTelegramSidebarWidth = (): number => {
  if (typeof window === 'undefined') {
    return TELEGRAM_SIDEBAR_DEFAULT_WIDTH_PX;
  }

  try {
    const storedWidth = Number(window.localStorage.getItem(TELEGRAM_SIDEBAR_STORAGE_KEY));
    return Number.isFinite(storedWidth) && storedWidth > 0
      ? storedWidth
      : TELEGRAM_SIDEBAR_DEFAULT_WIDTH_PX;
  } catch {
    return TELEGRAM_SIDEBAR_DEFAULT_WIDTH_PX;
  }
};

const buildMentionFallback = (displayName: string): string | null => {
  const normalized = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  return normalized ? `@${normalized}` : null;
};

const buildTelegramMentionSuggestions = (
  messages: NonNullable<ReturnType<typeof selectLegacyTelegramSnapshot>>['messages'],
): TelegramMentionSuggestion[] => {
  const suggestions = new Map<string, TelegramMentionSuggestion>();

  for (const message of messages) {
    if (message.outgoing) {
      continue;
    }

    const sender = message.sender.trim();
    if (!sender || sender.toLowerCase() === 'unknown' || sender.toLowerCase() === 'you') {
      continue;
    }

    const usernameMatch = /\(@([A-Za-z0-9_]{2,})\)\s*$/u.exec(sender);
    const username = usernameMatch?.[1];
    const displayName = usernameMatch ? sender.slice(0, usernameMatch.index).trim() : sender;
    const mention = username ? `@${username}` : buildMentionFallback(displayName);

    if (!mention || suggestions.has(mention.toLowerCase())) {
      continue;
    }

    suggestions.set(mention.toLowerCase(), {
      displayName: displayName || mention,
      mention,
      username,
    });
  }

  return [...suggestions.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
};

const getSelectedTelegramMessageText = (): string => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return '';
  }

  const messageList = document.querySelector<HTMLElement>('.telegram-message-list');
  if (!messageList) {
    return '';
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(messageList)) {
      return selection.toString().trim();
    }
  }

  return '';
};

const copyTextToClipboard = async (value: string): Promise<boolean> => {
  try {
    if (window.navigator.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to execCommand below.
  }

  const helper = document.createElement('textarea');
  helper.value = value;
  helper.setAttribute('readonly', 'true');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  helper.style.pointerEvents = 'none';
  document.body.append(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  return copied;
};

const FALLBACK_SHORTCUTS: ShortcutConfig = {
  forceNormalMode: 'CommandOrControl+[',
  openCommandPalette: 'CommandOrControl+K',
  openKeyboardHelp: 'Shift+/',
  focusSearch: '/',
  nextPane: 'Tab',
  previousPane: 'Shift+Tab',
  telegramNetwork: 'Alt+1',
};

export const AppShell = () => {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const [legacyApi, setLegacyApi] = useState<LegacyAppBridgeApi | null>(null);
  const [telegramMessageTarget, setTelegramMessageTarget] = useState<HTMLElement | null>(null);
  const [telegramComposerTarget, setTelegramComposerTarget] = useState<HTMLElement | null>(null);
  const [telegramCallHeaderTarget, setTelegramCallHeaderTarget] = useState<HTMLElement | null>(null);
  const [telegramCompactView, setTelegramCompactView] = useState<'chats' | 'messages'>('chats');
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth,
  );
  const [telegramSidebarWidth, setTelegramSidebarWidth] = useState(readTelegramSidebarWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const telegramSidebarResizerRef = useRef<HTMLDivElement | null>(null);
  const telegramSidebarPointerRef = useRef<number | null>(null);
  const telegramSidebarWidthRef = useRef(telegramSidebarWidth);
  const telegramSidebarDragBoundsRef = useRef<{
    left: number;
    width: number;
    initialSidebarWidth: number;
  } | null>(null);
  const telegramSidebarResizeFrameRef = useRef<number | null>(null);
  const pendingTelegramSidebarClientXRef = useRef<number | null>(null);
  const telegramChatListRef = useRef<HTMLElement | null>(null);
  const telegramSearchInputRef = useRef<HTMLInputElement | null>(null);
  const telegramComposerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingTelegramPaneFocusRef = useRef<'telegram-chats' | 'telegram-messages' | null>(null);
  const previousTelegramCompactLayoutRef = useRef(false);
  const imageActionToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const end = beginMeasure('app.boot');
    void loadRendererBootstrapData().then(({ appConfig, runtimeDiagnostics }) => {
      applyUserTheme(appConfig.userConfig);
      startTransition(() => {
        dispatch(configLoaded(appConfig, runtimeDiagnostics));
        dispatch({
          type: 'keyboard/config',
          showHints: appConfig.userConfig.keyboard.showHints,
          captureInWebview: appConfig.userConfig.keyboard.captureInWebview,
          enableCounts: appConfig.userConfig.keyboard.enableCounts,
        });
      });
      requestAnimationFrame(() => {
        end();
      });
    });
  }, [dispatch]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (windowWidth < TELEGRAM_COMPACT_BREAKPOINT_PX) {
      return;
    }

    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? windowWidth;
    setTelegramSidebarWidth((width) => {
      const nextWidth = clampTelegramSidebarWidth(width, workspaceWidth);
      telegramSidebarWidthRef.current = nextWidth;
      return nextWidth;
    });
  }, [windowWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TELEGRAM_SIDEBAR_STORAGE_KEY, String(telegramSidebarWidth));
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  }, [telegramSidebarWidth]);

  useEffect(
    () => () => {
      if (imageActionToastTimerRef.current !== null) {
        window.clearTimeout(imageActionToastTimerRef.current);
      }
      if (telegramSidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(telegramSidebarResizeFrameRef.current);
      }
    },
    [],
  );

  const shortcuts = state.config.appConfig?.shortcuts ?? FALLBACK_SHORTCUTS;
  const customKeymap = state.config.userConfig?.keyboard.keymap ?? {};

  const openCommandPalette = useEffectEvent(() => {
    const end = beginMeasure('command-palette.open');
    dispatch({ type: 'commandPalette/open' });
    requestAnimationFrame(() => {
      end();
    });
  });

  const closeCommandPalette = useEffectEvent(() => {
    dispatch({ type: 'commandPalette/close' });
  });

  const showImageActionToast = useEffectEvent((activity: AppActivity) => {
    dispatch({ type: 'activity/set', activity });

    if (imageActionToastTimerRef.current !== null) {
      window.clearTimeout(imageActionToastTimerRef.current);
    }

    imageActionToastTimerRef.current = window.setTimeout(() => {
      imageActionToastTimerRef.current = null;
      dispatch({ type: 'activity/set', activity: null });
    }, IMAGE_ACTION_TOAST_CLEAR_MS);
  });

  const handleCopyTelegramImagePreview = useEffectEvent(async () => {
    const copied = (await legacyApi?.copyTelegramImagePreview()) ?? false;
    showImageActionToast({
      id: `telegram-image-copy:${Date.now()}`,
      label: copied ? 'Image copied' : 'Image copy failed',
      detail: copied ? undefined : 'Could not copy the image to the clipboard.',
      state: copied ? 'success' : 'error',
    });
  });

  const handleDownloadTelegramImagePreview = useEffectEvent(() => {
    const started = legacyApi?.downloadTelegramImagePreview() ?? false;
    showImageActionToast({
      id: `telegram-image-download:${Date.now()}`,
      label: started ? 'Image download started' : 'Image download failed',
      detail: started ? undefined : 'Could not start the image download.',
      state: started ? 'success' : 'error',
    });
  });

  const ignoreKeyboardHelp = (): null => null;

  const bridge = useMemo(
    () => ({
      onActivityChange: (activity: typeof state.activity.current) => {
        dispatch({ type: 'activity/set', activity });
      },
      onReady: (api: LegacyAppBridgeApi) => {
        setLegacyApi(api);
        dispatch(legacyReady());
        dispatch(legacyCommandsChanged(api.getCommands()));
        dispatch(legacySnapshotChanged(api.getSnapshot()));
      },
      onSnapshotChange: (snapshot: ReturnType<LegacyAppBridgeApi['getSnapshot']>) => {
        dispatch(legacySnapshotChanged(snapshot));
      },
    }),
    [dispatch],
  );

  const commandItems = useMemo(
    () =>
      selectCommandPaletteItems(state).map((item) => ({
        id: item.id,
        label: item.label,
        group: item.group,
      })),
    [state],
  );

  const telegramSnapshot = selectLegacyTelegramSnapshot(state);
  const telegramMentionSuggestions = useMemo(
    () => (telegramSnapshot ? buildTelegramMentionSuggestions(telegramSnapshot.messages) : []),
    [telegramSnapshot?.messages],
  );
  const telegramCompactLayout =
    state.appShell.activeNetwork === 'telegram' &&
    telegramSnapshot !== null &&
    windowWidth < TELEGRAM_COMPACT_BREAKPOINT_PX;
  const telegramCompactShowChats =
    telegramCompactLayout &&
    (!telegramSnapshot?.activeChatId || telegramCompactView === 'chats');
  const telegramCompactShowMessages =
    telegramCompactLayout &&
    !!telegramSnapshot?.activeChatId &&
    telegramCompactView === 'messages';
  const showTelegramComposer =
    state.appShell.activeNetwork === 'telegram' &&
    telegramSnapshot !== null &&
    telegramSnapshot.activeChatCanSend &&
    !telegramCompactShowChats;
  const telegramMessagesVisible =
    state.appShell.activeNetwork === 'telegram' &&
    telegramSnapshot !== null &&
    !telegramCompactShowChats;
  const showTelegramChatList =
    state.appShell.activeNetwork === 'telegram' &&
    telegramSnapshot !== null &&
    (telegramCompactLayout ? telegramCompactShowChats : !telegramSnapshot.chatListMinimized);
  const telegramMessagesOnlyView =
    state.appShell.activeNetwork === 'telegram' &&
    telegramSnapshot !== null &&
    telegramMessagesVisible &&
    !showTelegramChatList;
  const telegramChatsOnlyView =
    state.appShell.activeNetwork === 'telegram' &&
    telegramSnapshot !== null &&
    showTelegramChatList &&
    !telegramMessagesVisible;

  useEffect(() => {
    if (state.appShell.activeNetwork !== 'telegram') {
      setTelegramCompactView('chats');
      previousTelegramCompactLayoutRef.current = false;
      return;
    }

    const enteringCompact = telegramCompactLayout && !previousTelegramCompactLayoutRef.current;
    previousTelegramCompactLayoutRef.current = telegramCompactLayout;

    if (!telegramCompactLayout) {
      return;
    }

    if (!telegramSnapshot?.activeChatId) {
      setTelegramCompactView('chats');
      return;
    }

    if (enteringCompact) {
      setTelegramCompactView(
        state.appShell.activePane === 'telegram-chats' ? 'chats' : 'messages',
      );
    }
  }, [
    state.appShell.activeNetwork,
    state.appShell.activePane,
    telegramCompactLayout,
    telegramSnapshot?.activeChatId,
  ]);

  const focusSearch = useEffectEvent(() => {
    if (state.appShell.activeNetwork === 'telegram') {
      if (!showTelegramChatList) {
        legacyApi?.focusSearch();
        return;
      }
      telegramSearchInputRef.current?.focus();
      telegramSearchInputRef.current?.select();
      return;
    }

    legacyApi?.focusSearch();
  });

  const focusTelegramPaneSurface = useEffectEvent((pane: 'telegram-chats' | 'telegram-messages') => {
    const fallbackSelector = pane === 'telegram-chats' ? '#telegram-chat-list' : '#telegram-message-list';
    const target =
      pane === 'telegram-chats'
        ? telegramChatListRef.current ?? document.querySelector<HTMLElement>(fallbackSelector)
        : (telegramMessageTarget?.closest('.telegram-message-list') as HTMLElement | null) ??
          document.querySelector<HTMLElement>(fallbackSelector);
    target?.focus({ preventScroll: true });
  });

  const scheduleTelegramPaneFocus = useEffectEvent((pane: 'telegram-chats' | 'telegram-messages') => {
    pendingTelegramPaneFocusRef.current = pane;
    focusTelegramPaneSurface(pane);
    requestAnimationFrame(() => {
      if (pendingTelegramPaneFocusRef.current === pane) {
        focusTelegramPaneSurface(pane);
      }
    });
  });

  const handleMoveLeft = useEffectEvent(() => {
    if (!legacyApi || state.appShell.activeNetwork !== 'telegram') {
      legacyApi?.movePane(-1);
      return;
    }

    if (
      telegramCompactLayout &&
      (telegramCompactShowMessages || state.appShell.activePane === 'telegram-composer')
    ) {
      setTelegramCompactView('chats');
      if (state.appShell.activePane === 'telegram-composer') {
        legacyApi.setMode('normal');
      }
      scheduleTelegramPaneFocus('telegram-chats');
      if (state.appShell.activePane !== 'telegram-chats') {
        legacyApi.movePane(-1);
      }
      return;
    }

    if (state.appShell.activePane === 'telegram-messages') {
      if (telegramCompactLayout || telegramMessagesOnlyView) {
        if (telegramCompactLayout) {
          setTelegramCompactView('chats');
        }
        if (showTelegramChatList) {
          scheduleTelegramPaneFocus('telegram-chats');
          legacyApi.movePane(-1);
        }
        return;
      }
      scheduleTelegramPaneFocus('telegram-chats');
      legacyApi.movePane(-1);
      return;
    }

    if (state.appShell.activePane === 'telegram-chats' || telegramChatsOnlyView) {
      scheduleTelegramPaneFocus('telegram-chats');
      return;
    }

    legacyApi.movePane(-1);
  });

  const handleMoveRight = useEffectEvent(() => {
    if (!legacyApi || state.appShell.activeNetwork !== 'telegram') {
      legacyApi?.movePane(1);
      return;
    }

    if (state.appShell.activePane === 'telegram-chats' || telegramChatsOnlyView) {
      if (!telegramMessagesVisible && !telegramCompactLayout) {
        scheduleTelegramPaneFocus('telegram-chats');
        return;
      }
      const nextChatId = telegramSnapshot?.selectedChatId;
      if (nextChatId && nextChatId !== telegramSnapshot?.activeChatId) {
        legacyApi.activateTelegramChat(nextChatId);
      }
      if (!nextChatId && !telegramSnapshot?.activeChatId) {
        scheduleTelegramPaneFocus('telegram-chats');
        return;
      }
      if (telegramCompactLayout) {
        setTelegramCompactView('messages');
      }
      scheduleTelegramPaneFocus('telegram-messages');
      legacyApi.activateTelegramMessagesPane();
      return;
    }

    if (
      state.appShell.activePane === 'telegram-messages' ||
      state.appShell.activePane === 'telegram-composer' ||
      telegramMessagesOnlyView
    ) {
      scheduleTelegramPaneFocus('telegram-messages');
      return;
    }

    legacyApi.movePane(1);
  });

  const handleTelegramChatSelect = useEffectEvent((chatId: string) => {
    const selectedChat = telegramSnapshot?.filteredChats.find((chat) => chat.id === chatId);
    console.info('[telegram][conversation-open] Opening conversation', {
      chatId,
      chatTitle: selectedChat?.title ?? 'Unknown chat',
      previousChatId: telegramSnapshot?.activeChatId ?? null,
      timestamp: new Date().toISOString(),
    });
    if (telegramCompactLayout) {
      setTelegramCompactView('messages');
    }
    legacyApi?.activateTelegramChat(chatId);
    if (telegramCompactLayout) {
      scheduleTelegramPaneFocus('telegram-messages');
      legacyApi?.activateTelegramMessagesPane();
    }
  });

  const handleTelegramBackToChats = useEffectEvent(() => {
    if (!legacyApi) {
      return;
    }

    setTelegramCompactView('chats');
    if (state.appShell.activePane === 'telegram-composer') {
      legacyApi.setMode('normal');
    }
    scheduleTelegramPaneFocus('telegram-chats');
    if (state.appShell.activePane !== 'telegram-chats') {
      legacyApi.movePane(-1);
    }
  });

  const previewTelegramSidebarResize = (clientX: number): number | null => {
    const dragBounds = telegramSidebarDragBoundsRef.current;
    const resizer = telegramSidebarResizerRef.current;
    if (!dragBounds || !resizer) {
      return null;
    }

    const nextWidth = clampTelegramSidebarWidth(
      clientX - dragBounds.left,
      dragBounds.width,
    );
    telegramSidebarWidthRef.current = nextWidth;
    const offset = nextWidth - dragBounds.initialSidebarWidth;
    resizer.style.transform = `translate3d(${offset}px, 0, 0)`;
    return nextWidth;
  };

  const flushTelegramSidebarResize = () => {
    telegramSidebarResizeFrameRef.current = null;
    const clientX = pendingTelegramSidebarClientXRef.current;
    pendingTelegramSidebarClientXRef.current = null;
    if (clientX !== null) {
      previewTelegramSidebarResize(clientX);
    }
  };

  const scheduleTelegramSidebarResize = (clientX: number) => {
    pendingTelegramSidebarClientXRef.current = clientX;
    if (telegramSidebarResizeFrameRef.current !== null) {
      return;
    }

    telegramSidebarResizeFrameRef.current = window.requestAnimationFrame(
      flushTelegramSidebarResize,
    );
  };

  const handleTelegramSidebarPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const workspaceBounds = workspaceRef.current?.getBoundingClientRect();
    if (!workspaceBounds) {
      return;
    }

    telegramSidebarDragBoundsRef.current = {
      left: workspaceBounds.left,
      width: workspaceBounds.width,
      initialSidebarWidth: telegramSidebarWidthRef.current,
    };
    telegramSidebarPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    workspaceRef.current?.classList.add('telegram-sidebar-resizing');
    previewTelegramSidebarResize(event.clientX);
  };

  const handleTelegramSidebarPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (telegramSidebarPointerRef.current !== event.pointerId) {
      return;
    }

    scheduleTelegramSidebarResize(event.clientX);
  };

  const finishTelegramSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (telegramSidebarPointerRef.current !== event.pointerId) {
      return;
    }

    const finalClientX =
      event.type === 'pointercancel'
        ? (pendingTelegramSidebarClientXRef.current ?? event.clientX)
        : event.clientX;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (telegramSidebarResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(telegramSidebarResizeFrameRef.current);
      telegramSidebarResizeFrameRef.current = null;
    }
    pendingTelegramSidebarClientXRef.current = null;
    previewTelegramSidebarResize(finalClientX);
    workspaceRef.current?.style.setProperty(
      '--telegram-sidebar-width',
      `${telegramSidebarWidthRef.current}px`,
    );
    telegramSidebarResizerRef.current?.style.removeProperty('transform');
    telegramSidebarPointerRef.current = null;
    telegramSidebarDragBoundsRef.current = null;
    workspaceRef.current?.classList.remove('telegram-sidebar-resizing');
    setTelegramSidebarWidth(telegramSidebarWidthRef.current);
  };

  const handleTelegramSidebarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? windowWidth;
    const bounds = getTelegramSidebarBounds(workspaceWidth);
    let nextWidth: number | null = null;

    if (event.key === 'ArrowLeft') {
      nextWidth = telegramSidebarWidthRef.current - 16;
    } else if (event.key === 'ArrowRight') {
      nextWidth = telegramSidebarWidthRef.current + 16;
    } else if (event.key === 'Home') {
      nextWidth = bounds.min;
    } else if (event.key === 'End') {
      nextWidth = bounds.max;
    }

    if (nextWidth === null) {
      return;
    }

    event.preventDefault();
    const clampedWidth = clampTelegramSidebarWidth(nextWidth, workspaceWidth);
    telegramSidebarWidthRef.current = clampedWidth;
    setTelegramSidebarWidth(clampedWidth);
  };

  const handleEscape = useEffectEvent((): boolean => {
    if (
      state.appShell.activeNetwork !== 'telegram' ||
      !telegramCompactShowMessages ||
      telegramSnapshot?.imagePreviewUrl ||
      telegramSnapshot?.forward.visible ||
      telegramSnapshot?.contextMenu.visible
    ) {
      return false;
    }

    handleTelegramBackToChats();
    return true;
  });

  useEffect(() => {
    const offOpenPalette = window.pelec.onOpenCommandPalette(() => {
      openCommandPalette();
    });

    return () => {
      offOpenPalette();
    };
  }, [openCommandPalette]);

  useEffect(() => {
    if (!state.appShell.legacyReady) {
      setTelegramMessageTarget(null);
      setTelegramComposerTarget(null);
      setTelegramCallHeaderTarget(null);
      return;
    }

    setTelegramMessageTarget(document.querySelector<HTMLElement>('#telegram-message-react-root'));
    setTelegramComposerTarget(document.querySelector<HTMLElement>('#telegram-compose-react-root'));
    setTelegramCallHeaderTarget(document.querySelector<HTMLElement>('#telegram-call-actions-root'));
  }, [state.appShell.legacyReady]);

  useEffect(() => {
    legacyApi?.setTelegramMessagesVisible(telegramMessagesVisible);
  }, [legacyApi, telegramMessagesVisible]);

  useEffect(() => {
    if (showTelegramComposer && state.appShell.mode === 'insert') {
      telegramComposerInputRef.current?.focus();
    }
  }, [showTelegramComposer, state.appShell.mode]);

  useEffect(() => {
    if (
      state.appShell.activeNetwork !== 'telegram' ||
      state.appShell.activePane !== 'telegram-messages' ||
      !legacyApi ||
      !telegramSnapshot ||
      telegramSnapshot.selectedMessageId ||
      telegramSnapshot.messages.length < 1
    ) {
      return;
    }

    const fallbackMessageId = telegramSnapshot.messages[telegramSnapshot.messages.length - 1]?.id;
    if (fallbackMessageId) {
      legacyApi.selectTelegramMessage(fallbackMessageId);
    }
  }, [
    legacyApi,
    state.appShell.activeNetwork,
    state.appShell.activePane,
    telegramSnapshot,
  ]);

  useEffect(() => {
    const pendingPane = pendingTelegramPaneFocusRef.current;
    if (!pendingPane || state.appShell.activeNetwork !== 'telegram') {
      return;
    }

    if (pendingPane !== state.appShell.activePane) {
      return;
    }

    focusTelegramPaneSurface(pendingPane);
    pendingTelegramPaneFocusRef.current = null;
  }, [focusTelegramPaneSurface, state.appShell.activeNetwork, state.appShell.activePane, telegramMessageTarget]);

  useKeyboardBindings({
    activePane: state.appShell.activePane,
    captureInWebview: state.keyboard.captureInWebview,
    closeCommandPalette: () => closeCommandPalette(),
    closeKeyboardHelp: () => ignoreKeyboardHelp(),
    commandPaletteOpen: state.commandPalette.isOpen,
    customKeymap,
    keyboardHelpOpen: false,
    legacyApi,
    mode: state.appShell.mode,
    onEscape: () => handleEscape(),
    onFocusSearch: () => focusSearch(),
    onMoveLeft: () => handleMoveLeft(),
    onMoveRight: () => handleMoveRight(),
    openCommandPalette: () => openCommandPalette(),
    openKeyboardHelp: () => ignoreKeyboardHelp(),
    setMode: (mode) => {
      if (mode === 'command') {
        openCommandPalette();
      }
    },
    shortcuts,
  });

  const executeCommand = (item: CommandPaletteItem) => {
    if (item.id === 'toggle-send-behavior') {
      legacyApi?.toggleSendBehavior();
      dispatch({ type: 'config/toggleSendBehavior' });
      closeCommandPalette();
      return;
    }
    if (item.id === 'focusSearch') {
      focusSearch();
      closeCommandPalette();
      return;
    }

    legacyApi?.executeCommand(item.id);
    closeCommandPalette();
  };

  const handleTelegramOpenConfig = useEffectEvent(async () => {
    const configPath = state.config.appConfig?.configPath;
    if (!configPath) {
      return;
    }
    await window.pelec.openPath(configPath);
  });

  const handleSaveSettings = useEffectEvent(async (userConfig: UserConfig) => {
    const appConfig = await window.pelec.saveConfig(userConfig);
    applyUserTheme(userConfig);
    dispatch(configLoaded(appConfig, state.config.runtimeDiagnostics));
    dispatch({
      type: 'keyboard/config',
      showHints: userConfig.keyboard.showHints,
      captureInWebview: userConfig.keyboard.captureInWebview,
      enableCounts: userConfig.keyboard.enableCounts,
    });
  });

  const handleTelegramClearCache = useEffectEvent(async () => {
    await window.pelec.clearAppCache();
    legacyApi?.refresh();
  });

  const handleTelegramLogin = useEffectEvent(async () => {
    legacyApi?.startAuth();
  });

  const handleTelegramLogout = useEffectEvent(async () => {
    await window.pelec.resetConnectorAuth('telegram');
    legacyApi?.refresh();
  });

  const handleTelegramRefresh = useEffectEvent(async () => {
    legacyApi?.refresh();
  });

  const handleTelegramClearSearch = useEffectEvent(() => {
    legacyApi?.setTelegramSearchQuery('');
  });

  const handleTelegramContextCopy = useEffectEvent((messageId: string) => {
    const message = telegramSnapshot?.messages.find((candidate) => candidate.id === messageId);
    if (message?.imageUrl || message?.imageDeferred) {
      legacyApi?.copyTelegramMessageImage(messageId);
      return;
    }

    if (state.config.userConfig?.telegram.selectableMessageText) {
      const selectedText = getSelectedTelegramMessageText();
      if (selectedText) {
        void copyTextToClipboard(selectedText);
        return;
      }
    }

    legacyApi?.copyTelegramMessage(messageId);
  });

  const handleTelegramContextDelete = useEffectEvent((messageId: string) => {
    legacyApi?.selectTelegramMessage(messageId);
    legacyApi?.deleteSelection();
  });

  const handleTelegramContextEdit = useEffectEvent((messageId: string) => {
    legacyApi?.editTelegramMessage(messageId);
  });

  const handleTelegramContextReact = useEffectEvent((messageId: string, reaction: string) => {
    void legacyApi?.setTelegramMessageReaction(messageId, reaction);
  });

  return (
    <div className="modern-app-shell">
      <div
        ref={workspaceRef}
        className={`modern-workspace${
          showTelegramChatList ? ' react-telegram-chat-list' : ''
        }${showTelegramComposer ? ' react-telegram-composer' : ''}${
          telegramCompactLayout ? ' telegram-compact-layout' : ''
        }${telegramCompactShowChats ? ' telegram-compact-show-chats' : ''}${
          telegramCompactShowMessages ? ' telegram-compact-show-messages' : ''
        }`}
        style={{ '--telegram-sidebar-width': `${telegramSidebarWidth}px` } as CSSProperties}
      >
        <WebviewHost>
          <LegacyWorkspaceAdapter bridge={bridge} />
        </WebviewHost>
        {showTelegramChatList && telegramSnapshot ? (
          <TelegramChatList
            activeChatId={telegramSnapshot.activeChatId}
            chats={telegramSnapshot.filteredChats}
            configPath={state.config.appConfig?.configPath ?? null}
            listRef={telegramChatListRef}
            loadError={telegramSnapshot.loadError}
            loading={telegramSnapshot.loading}
            onClearCache={() => void handleTelegramClearCache()}
            onClearSearch={handleTelegramClearSearch}
            onLogin={() => void handleTelegramLogin()}
            onLogout={() => void handleTelegramLogout()}
            onOpenAbout={() => setAboutOpen(true)}
            onOpenConfig={() => void handleTelegramOpenConfig()}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefresh={() => void handleTelegramRefresh()}
            onSearchQueryChange={(query) => legacyApi?.setTelegramSearchQuery(query)}
            onSelectChat={(chatId) => handleTelegramChatSelect(chatId)}
            searchInputRef={telegramSearchInputRef}
            searchQuery={telegramSnapshot.searchQuery}
            selectedChatId={
              state.appShell.activePane === 'telegram-chats' ? telegramSnapshot.selectedChatId : null
            }
          />
        ) : null}
        {showTelegramChatList && telegramMessagesVisible && !telegramCompactLayout ? (
          <div
            ref={telegramSidebarResizerRef}
            className="telegram-sidebar-resizer"
            role="separator"
            aria-label="Resize Telegram chat sidebar"
            aria-orientation="vertical"
            aria-valuemin={getTelegramSidebarBounds(windowWidth).min}
            aria-valuemax={getTelegramSidebarBounds(windowWidth).max}
            aria-valuenow={Math.round(telegramSidebarWidth)}
            tabIndex={0}
            onKeyDown={handleTelegramSidebarKeyDown}
            onPointerCancel={finishTelegramSidebarResize}
            onPointerDown={handleTelegramSidebarPointerDown}
            onPointerMove={handleTelegramSidebarPointerMove}
            onPointerUp={finishTelegramSidebarResize}
          />
        ) : null}
        {state.appShell.activeNetwork === 'telegram' && telegramSnapshot && !telegramCompactShowChats ? (
          <TelegramConversationErrorBoundary
            activeChatId={telegramSnapshot.activeChatId}
            activeChatTitle={telegramSnapshot.activeChatTitle}
            messageIds={telegramSnapshot.messages.map((message) => message.id)}
            onBackToChats={telegramCompactShowMessages ? () => handleTelegramBackToChats() : undefined}
            target={telegramMessageTarget}
          >
            <TelegramMessageList
              activeChatId={telegramSnapshot.activeChatId}
              activeChatTitle={telegramSnapshot.activeChatTitle}
              canDropFiles={telegramSnapshot.activeChatCanSend}
              hasOlderMessages={telegramSnapshot.hasOlderMessages}
              legacyApi={legacyApi}
              loadError={telegramSnapshot.messageLoadError}
              loadingOlderMessages={telegramSnapshot.loadingOlderMessages}
              messages={telegramSnapshot.messages}
              messagesLoading={telegramSnapshot.messagesLoading}
              messageTextSelectable={state.config.userConfig?.telegram.selectableMessageText ?? false}
              onBackToChats={telegramCompactShowMessages ? () => handleTelegramBackToChats() : undefined}
              selectedMessageId={
                state.appShell.activePane === 'telegram-messages'
                  ? telegramSnapshot.selectedMessageId
                  : null
              }
              target={telegramMessageTarget}
            />
          </TelegramConversationErrorBoundary>
        ) : null}
        {showTelegramComposer ? (
          <TelegramComposer
            activeChatId={telegramSnapshot.activeChatId}
            appMode={state.appShell.mode}
            attachments={telegramSnapshot.pendingAttachments}
            canSend={telegramSnapshot.activeChatCanSend}
            draftText={telegramSnapshot.draftText}
            editing={telegramSnapshot.editing}
            inputRef={telegramComposerInputRef}
            legacyApi={legacyApi}
            mentionSuggestions={telegramMentionSuggestions}
            onModeChange={(mode) => legacyApi?.setMode(mode)}
            replyToMessageId={telegramSnapshot.replyToMessageId}
            replyPreview={telegramSnapshot.replyPreview}
            sendBehavior={state.config.userConfig?.keyboard.sendBehavior ?? 'enter'}
            target={telegramComposerTarget}
            vimCountsEnabled={state.config.userConfig?.keyboard.enableCounts ?? true}
            vimModeEnabled={state.config.userConfig?.keyboard.enableVimMode ?? true}
            voiceRecorderState={telegramSnapshot.voiceRecorderState}
          />
        ) : null}
      </div>
      {settingsOpen && state.config.userConfig ? (
        <SettingsDialog
          config={state.config.userConfig}
          onClose={() => setSettingsOpen(false)}
          onOpenConfigFile={() => void handleTelegramOpenConfig()}
          onSave={handleSaveSettings}
        />
      ) : null}
      {aboutOpen ? (
        <AboutDialog
          version={state.config.appConfig?.version ?? '1.0.0'}
          onClose={() => setAboutOpen(false)}
        />
      ) : null}
      <ModalLayer
        authPrompt={state.legacy.snapshot?.authPrompt ?? null}
        commandItems={commandItems}
        commandPaletteOpen={state.commandPalette.isOpen}
        commandQuery={state.commandPalette.query}
        onCancelAuthPrompt={() => legacyApi?.cancelAuthPrompt()}
        onCloseCommandPalette={() => closeCommandPalette()}
        onCloseQrAuth={() => legacyApi?.closeQrAuth()}
        onCloseTelegramContextMenu={() => legacyApi?.closeTelegramContextMenu()}
        onCloseTelegramForward={() => legacyApi?.closeTelegramForwardMenu()}
        onCloseTelegramImagePreview={() => legacyApi?.closeTelegramImagePreview()}
        onCommandQueryChange={(query) => dispatch({ type: 'commandPalette/query', query })}
        onCopyTelegramMessage={handleTelegramContextCopy}
        onDeleteTelegramMessage={handleTelegramContextDelete}
        onEditTelegramMessage={handleTelegramContextEdit}
        onCopyTelegramImagePreview={() => {
          void handleCopyTelegramImagePreview();
        }}
        onDownloadTelegramImagePreview={handleDownloadTelegramImagePreview}
        onExecuteCommand={executeCommand}
        onForwardTelegramMessage={(chatId) => legacyApi?.forwardTelegramMessageToChat(chatId)}
        onOpenTelegramForwardMenu={(messageId) => legacyApi?.openTelegramForwardMenu(messageId)}
        onReactToTelegramMessage={handleTelegramContextReact}
        onRefreshQrAuth={() => legacyApi?.refreshQrAuth()}
        onRevealQrPassword={() => legacyApi?.revealQrPassword()}
        onReplyToTelegramMessage={(messageId) => {
          legacyApi?.selectTelegramMessage(messageId);
          legacyApi?.reply();
        }}
        onSelectedIndexChange={(index) => dispatch({ type: 'commandPalette/select', index })}
        onSelectTelegramMessage={(messageId) => legacyApi?.selectTelegramMessage(messageId)}
        onSubmitAuthPrompt={(value) => legacyApi?.submitAuthPrompt(value)}
        onSubmitQrPassword={(value) => legacyApi?.submitQrPassword(value)}
        onTelegramForwardQueryChange={(query) => legacyApi?.setTelegramForwardQuery(query)}
        qrAuth={state.legacy.snapshot?.qrAuth ?? null}
        selectedIndex={state.commandPalette.selectedIndex}
        telegramContextMenu={telegramSnapshot?.contextMenu ?? null}
        telegramForward={telegramSnapshot?.forward ?? null}
        telegramImagePreviewMeta={telegramSnapshot?.imagePreviewMeta ?? null}
        telegramImagePreviewUrl={telegramSnapshot?.imagePreviewUrl ?? null}
      />
      <TelegramCallLayer
        activeChatId={telegramSnapshot?.activeChatId ?? null}
        capabilities={
          telegramSnapshot?.filteredChats.find(
            (chat) => chat.id === telegramSnapshot.activeChatId,
          )?.telegramCallCapabilities
        }
        headerTarget={telegramCallHeaderTarget}
      />
      <StatusLayer />
    </div>
  );
};
