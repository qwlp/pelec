import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ShortcutConfig } from '../../shared/types';
import { useKeyboardBindings } from '../keyboard/useKeyboardBindings';
import type { LegacyAppBridgeApi } from '../legacyBridge';
import { applyUserTheme } from '../lib/theme';
import type { CommandPaletteItem } from '../features/commandPalette/CommandPalette';
import { InstagramChatList } from '../features/instagram/InstagramChatList';
import { InstagramComposer } from '../features/instagram/InstagramComposer';
import { InstagramMessageList } from '../features/instagram/InstagramMessageList';
import { TelegramChatList } from '../features/telegram/TelegramChatList';
import { TelegramComposer } from '../features/telegram/TelegramComposer';
import { TelegramMessageList } from '../features/telegram/TelegramMessageList';
import { loadRendererBootstrapData } from '../services/connectors';
import { beginMeasure } from '../services/performance';
import { configLoaded, legacyCommandsChanged, legacyReady, legacySnapshotChanged } from '../state/actions';
import { useAppDispatch, useAppState } from '../state/appStore';
import {
  selectCommandPaletteItems,
  selectLegacyInstagramSnapshot,
  selectLegacyTelegramSnapshot,
} from '../state/selectors';
import { LegacyWorkspaceAdapter } from './LegacyWorkspaceAdapter';
import { ModalLayer } from './ModalLayer';
import { WebviewHost } from './WebviewHost';

const TELEGRAM_COMPACT_BREAKPOINT_PX = 820;

const FALLBACK_SHORTCUTS: ShortcutConfig = {
  forceNormalMode: 'CommandOrControl+[',
  openCommandPalette: 'CommandOrControl+K',
  openKeyboardHelp: 'Shift+/',
  focusSearch: '/',
  nextPane: 'Tab',
  previousPane: 'Shift+Tab',
  telegramNetwork: 'Alt+1',
  instagramNetwork: 'Alt+2',
};

export const AppShell = () => {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const [legacyApi, setLegacyApi] = useState<LegacyAppBridgeApi | null>(null);
  const [telegramMessageTarget, setTelegramMessageTarget] = useState<HTMLElement | null>(null);
  const [telegramComposerTarget, setTelegramComposerTarget] = useState<HTMLElement | null>(null);
  const [instagramCompactView, setInstagramCompactView] = useState<'chats' | 'messages'>('chats');
  const [telegramCompactView, setTelegramCompactView] = useState<'chats' | 'messages'>('chats');
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth,
  );
  const instagramChatListRef = useRef<HTMLDivElement | null>(null);
  const instagramComposerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const instagramSearchInputRef = useRef<HTMLInputElement | null>(null);
  const telegramChatListRef = useRef<HTMLElement | null>(null);
  const telegramSearchInputRef = useRef<HTMLInputElement | null>(null);
  const telegramComposerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingInstagramPaneFocusRef = useRef<'instagram-chats' | 'instagram-messages' | null>(null);
  const previousInstagramCompactLayoutRef = useRef(false);
  const pendingTelegramPaneFocusRef = useRef<'telegram-chats' | 'telegram-messages' | null>(null);
  const previousTelegramCompactLayoutRef = useRef(false);

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

  const instagramSnapshot = selectLegacyInstagramSnapshot(state);
  const telegramSnapshot = selectLegacyTelegramSnapshot(state);
  const instagramCompactLayout =
    state.appShell.activeNetwork === 'instagram' &&
    instagramSnapshot !== null &&
    windowWidth < TELEGRAM_COMPACT_BREAKPOINT_PX;
  const instagramCompactShowChats =
    instagramCompactLayout &&
    (!instagramSnapshot?.activeChatId || instagramCompactView === 'chats');
  const instagramCompactShowMessages =
    instagramCompactLayout &&
    !!instagramSnapshot?.activeChatId &&
    instagramCompactView === 'messages';
  const showInstagramComposer =
    state.appShell.activeNetwork === 'instagram' &&
    instagramSnapshot !== null &&
    instagramSnapshot.activeChatCanSend &&
    !instagramCompactShowChats;
  const showInstagramChatList =
    state.appShell.activeNetwork === 'instagram' &&
    instagramSnapshot !== null &&
    (instagramCompactLayout ? instagramCompactShowChats : true);
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

  useEffect(() => {
    if (state.appShell.activeNetwork !== 'instagram') {
      setInstagramCompactView('chats');
      previousInstagramCompactLayoutRef.current = false;
      return;
    }

    const enteringCompact = instagramCompactLayout && !previousInstagramCompactLayoutRef.current;
    previousInstagramCompactLayoutRef.current = instagramCompactLayout;

    if (!instagramCompactLayout) {
      return;
    }

    if (!instagramSnapshot?.activeChatId) {
      setInstagramCompactView('chats');
      return;
    }

    if (enteringCompact) {
      setInstagramCompactView(
        state.appShell.activePane === 'instagram-chats' ? 'chats' : 'messages',
      );
    }
  }, [
    instagramCompactLayout,
    instagramSnapshot?.activeChatId,
    state.appShell.activeNetwork,
    state.appShell.activePane,
  ]);

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

    if (state.appShell.activeNetwork === 'instagram') {
      instagramSearchInputRef.current?.focus();
      instagramSearchInputRef.current?.select();
      return;
    }

    legacyApi?.focusSearch();
  });

  const focusInstagramPaneSurface = useEffectEvent((pane: 'instagram-chats' | 'instagram-messages') => {
    const fallbackSelector = pane === 'instagram-chats' ? '#instagram-chat-list' : '#instagram-message-list';
    const target =
      pane === 'instagram-chats'
        ? instagramChatListRef.current ?? document.querySelector<HTMLElement>(fallbackSelector)
        : document.querySelector<HTMLElement>(fallbackSelector);
    target?.focus({ preventScroll: true });
  });

  const scheduleInstagramPaneFocus = useEffectEvent(
    (pane: 'instagram-chats' | 'instagram-messages') => {
      pendingInstagramPaneFocusRef.current = pane;
      focusInstagramPaneSurface(pane);
      requestAnimationFrame(() => {
        if (pendingInstagramPaneFocusRef.current === pane) {
          focusInstagramPaneSurface(pane);
        }
      });
    },
  );

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
    if (!legacyApi) {
      legacyApi?.movePane(-1);
      return;
    }

    if (state.appShell.activeNetwork === 'instagram') {
      if (instagramCompactLayout && state.appShell.activePane === 'instagram-composer') {
        setInstagramCompactView('chats');
        legacyApi.setMode('normal');
        scheduleInstagramPaneFocus('instagram-chats');
        legacyApi.movePane(-1);
        return;
      }

      if (state.appShell.activePane === 'instagram-messages') {
        if (instagramCompactLayout) {
          setInstagramCompactView('chats');
        }
        scheduleInstagramPaneFocus('instagram-chats');
        legacyApi.movePane(-1);
        return;
      }

      if (state.appShell.activePane === 'instagram-chats') {
        scheduleInstagramPaneFocus('instagram-chats');
        return;
      }

      legacyApi.movePane(-1);
      return;
    }

    if (telegramCompactLayout && state.appShell.activePane === 'telegram-composer') {
      setTelegramCompactView('chats');
      legacyApi.setMode('normal');
      scheduleTelegramPaneFocus('telegram-chats');
      legacyApi.movePane(-1);
      return;
    }

    if (state.appShell.activePane === 'telegram-messages') {
      if (telegramCompactLayout) {
        setTelegramCompactView('chats');
      }
      scheduleTelegramPaneFocus('telegram-chats');
      legacyApi.movePane(-1);
      return;
    }

    if (state.appShell.activePane === 'telegram-chats') {
      scheduleTelegramPaneFocus('telegram-chats');
      return;
    }

    legacyApi.movePane(-1);
  });

  const handleMoveRight = useEffectEvent(() => {
    if (!legacyApi) {
      legacyApi?.movePane(1);
      return;
    }

    if (state.appShell.activeNetwork === 'instagram') {
      if (state.appShell.activePane === 'instagram-chats') {
        const nextChatId = instagramSnapshot?.selectedChatId;
        if (nextChatId && nextChatId !== instagramSnapshot?.activeChatId) {
          legacyApi.activateInstagramChat(nextChatId);
        }
        if (instagramCompactLayout) {
          setInstagramCompactView('messages');
        }
        scheduleInstagramPaneFocus('instagram-messages');
        legacyApi.activateInstagramMessagesPane();
        return;
      }

      if (state.appShell.activePane === 'instagram-messages') {
        scheduleInstagramPaneFocus('instagram-messages');
        return;
      }

      legacyApi.movePane(1);
      return;
    }

    if (state.appShell.activePane === 'telegram-chats') {
      const nextChatId = telegramSnapshot?.selectedChatId;
      if (nextChatId && nextChatId !== telegramSnapshot?.activeChatId) {
        legacyApi.activateTelegramChat(nextChatId);
      }
      if (telegramCompactLayout) {
        setTelegramCompactView('messages');
      }
      scheduleTelegramPaneFocus('telegram-messages');
      legacyApi.activateTelegramMessagesPane();
      return;
    }

    if (state.appShell.activePane === 'telegram-messages') {
      scheduleTelegramPaneFocus('telegram-messages');
      return;
    }

    legacyApi.movePane(1);
  });

  const handleTelegramChatSelect = useEffectEvent((chatId: string) => {
    if (telegramCompactLayout) {
      setTelegramCompactView('messages');
    }
    legacyApi?.activateTelegramChat(chatId);
    if (telegramCompactLayout) {
      scheduleTelegramPaneFocus('telegram-messages');
      legacyApi?.activateTelegramMessagesPane();
    }
  });

  const handleInstagramChatSelect = useEffectEvent((chatId: string) => {
    if (instagramCompactLayout) {
      setInstagramCompactView('messages');
    }
    legacyApi?.activateInstagramChat(chatId);
    if (instagramCompactLayout) {
      scheduleInstagramPaneFocus('instagram-messages');
      legacyApi?.activateInstagramMessagesPane();
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

  const handleInstagramBackToChats = useEffectEvent(() => {
    if (!legacyApi) {
      return;
    }

    setInstagramCompactView('chats');
    if (state.appShell.activePane === 'instagram-composer') {
      legacyApi.setMode('normal');
    }
    scheduleInstagramPaneFocus('instagram-chats');
    if (state.appShell.activePane !== 'instagram-chats') {
      legacyApi.movePane(-1);
    }
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
      return;
    }

    setTelegramMessageTarget(document.querySelector<HTMLElement>('#telegram-message-react-root'));
    setTelegramComposerTarget(document.querySelector<HTMLElement>('#telegram-compose-react-root'));
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
    if (showInstagramComposer && state.appShell.mode === 'insert') {
      instagramComposerInputRef.current?.focus();
    }
  }, [showInstagramComposer, state.appShell.mode]);

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
    if (
      state.appShell.activeNetwork !== 'instagram' ||
      state.appShell.activePane !== 'instagram-messages' ||
      !legacyApi ||
      !instagramSnapshot ||
      instagramSnapshot.selectedMessageId ||
      instagramSnapshot.messages.length < 1
    ) {
      return;
    }

    const fallbackMessageId = instagramSnapshot.messages[instagramSnapshot.messages.length - 1]?.id;
    if (fallbackMessageId) {
      legacyApi.selectInstagramMessage(fallbackMessageId);
    }
  }, [
    instagramSnapshot,
    legacyApi,
    state.appShell.activeNetwork,
    state.appShell.activePane,
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

  useEffect(() => {
    const pendingPane = pendingInstagramPaneFocusRef.current;
    if (!pendingPane || state.appShell.activeNetwork !== 'instagram') {
      return;
    }

    if (pendingPane !== state.appShell.activePane) {
      return;
    }

    focusInstagramPaneSurface(pendingPane);
    pendingInstagramPaneFocusRef.current = null;
  }, [focusInstagramPaneSurface, state.appShell.activeNetwork, state.appShell.activePane]);

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

  return (
    <div className="modern-app-shell">
      <div
        className={`modern-workspace${
          state.appShell.activeNetwork === 'instagram' ? ' instagram-active' : ''
        }${
          showTelegramChatList ? ' react-telegram-chat-list' : ''
        }${showTelegramComposer ? ' react-telegram-composer' : ''}${
          instagramCompactLayout ? ' instagram-compact-layout' : ''
        }${instagramCompactShowChats ? ' instagram-compact-show-chats' : ''}${
          instagramCompactShowMessages ? ' instagram-compact-show-messages' : ''
        }${
          telegramCompactLayout ? ' telegram-compact-layout' : ''
        }${telegramCompactShowChats ? ' telegram-compact-show-chats' : ''}${
          telegramCompactShowMessages ? ' telegram-compact-show-messages' : ''
        }`}
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
            onOpenConfig={() => void handleTelegramOpenConfig()}
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
        {state.appShell.activeNetwork === 'telegram' && telegramSnapshot && !telegramCompactShowChats ? (
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
            onBackToChats={telegramCompactShowMessages ? () => handleTelegramBackToChats() : undefined}
            selectedMessageId={
              state.appShell.activePane === 'telegram-messages'
                ? telegramSnapshot.selectedMessageId
                : null
            }
            target={telegramMessageTarget}
          />
        ) : null}
        {showTelegramComposer ? (
          <TelegramComposer
            attachments={telegramSnapshot.pendingAttachments}
            canSend={telegramSnapshot.activeChatCanSend}
            draftText={telegramSnapshot.draftText}
            inputRef={telegramComposerInputRef}
            legacyApi={legacyApi}
            replyPreview={telegramSnapshot.replyPreview}
            sendBehavior={state.config.userConfig?.keyboard.sendBehavior ?? 'enter'}
            target={telegramComposerTarget}
            voiceRecorderState={telegramSnapshot.voiceRecorderState}
          />
        ) : null}
        {showInstagramChatList && instagramSnapshot ? (
          <InstagramChatList
            activeChatId={instagramSnapshot.activeChatId}
            chats={instagramSnapshot.filteredChats}
            listRef={instagramChatListRef}
            loadError={instagramSnapshot.loadError}
            loading={instagramSnapshot.loading}
            onRefresh={() => legacyApi?.refresh()}
            onSearchQueryChange={(query) => legacyApi?.setInstagramSearchQuery(query)}
            onSelectChat={(chatId) => handleInstagramChatSelect(chatId)}
            onStartAuth={() => void legacyApi?.startAuth()}
            searchInputRef={instagramSearchInputRef}
            searchQuery={instagramSnapshot.searchQuery}
            selectedChatId={
              state.appShell.activePane === 'instagram-chats'
                ? instagramSnapshot.selectedChatId
                : null
            }
          />
        ) : null}
        {state.appShell.activeNetwork === 'instagram' && instagramSnapshot && !instagramCompactShowChats ? (
          <InstagramMessageList
            activeChatId={instagramSnapshot.activeChatId}
            activeChatTitle={instagramSnapshot.activeChatTitle}
            loadError={instagramSnapshot.messageLoadError}
            messages={instagramSnapshot.messages}
            messagesLoading={instagramSnapshot.messagesLoading}
            onBackToChats={instagramCompactShowMessages ? () => handleInstagramBackToChats() : undefined}
            selectedMessageId={
              state.appShell.activePane === 'instagram-messages'
                ? instagramSnapshot.selectedMessageId
                : null
            }
          />
        ) : null}
        {showInstagramComposer && instagramSnapshot ? (
          <InstagramComposer
            attachments={instagramSnapshot.pendingAttachments}
            canSend={instagramSnapshot.activeChatCanSend}
            draftText={instagramSnapshot.draftText}
            inputRef={instagramComposerInputRef}
            onClearReply={() => legacyApi?.clearInstagramReply()}
            onDraftChange={(value) => legacyApi?.setInstagramDraftValue(value)}
            onPickFiles={(files) => {
              if (!files || files.length < 1) {
                return;
              }
              legacyApi?.appendInstagramFiles(Array.from(files));
            }}
            onRemoveAttachment={(attachmentId) => legacyApi?.removeInstagramAttachment(attachmentId)}
            onSend={() => legacyApi?.sendInstagramMessage()}
            replyPreview={instagramSnapshot.replyPreview}
          />
        ) : null}
      </div>
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
        onCopyTelegramMessage={(messageId) => legacyApi?.copyTelegramMessage(messageId)}
        onCopyTelegramImagePreview={() => legacyApi?.copyTelegramImagePreview()}
        onDownloadTelegramImagePreview={() => legacyApi?.downloadTelegramImagePreview()}
        onExecuteCommand={executeCommand}
        onForwardTelegramMessage={(chatId) => legacyApi?.forwardTelegramMessageToChat(chatId)}
        onOpenTelegramForwardMenu={(messageId) => legacyApi?.openTelegramForwardMenu(messageId)}
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
        telegramImagePreviewUrl={telegramSnapshot?.imagePreviewUrl ?? null}
      />
    </div>
  );
};
