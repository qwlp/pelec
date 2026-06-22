import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ShortcutConfig } from '../../shared/types';
import { useKeyboardBindings } from '../keyboard/useKeyboardBindings';
import type { LegacyAppBridgeApi } from '../legacyBridge';
import { applyUserTheme } from '../lib/theme';
import type { CommandPaletteItem } from '../features/commandPalette/CommandPalette';
import { TelegramChatList } from '../features/telegram/TelegramChatList';
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
import { WebviewHost } from './WebviewHost';

const TELEGRAM_COMPACT_BREAKPOINT_PX = 820;

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
  const [telegramCompactView, setTelegramCompactView] = useState<'chats' | 'messages'>('chats');
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth,
  );
  const telegramChatListRef = useRef<HTMLElement | null>(null);
  const telegramSearchInputRef = useRef<HTMLInputElement | null>(null);
  const telegramComposerInputRef = useRef<HTMLTextAreaElement | null>(null);
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

  return (
    <div className="modern-app-shell">
      <div
        className={`modern-workspace${
          showTelegramChatList ? ' react-telegram-chat-list' : ''
        }${showTelegramComposer ? ' react-telegram-composer' : ''}${
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
            attachments={telegramSnapshot.pendingAttachments}
            canSend={telegramSnapshot.activeChatCanSend}
            draftText={telegramSnapshot.draftText}
            inputRef={telegramComposerInputRef}
            legacyApi={legacyApi}
            mentionSuggestions={telegramMentionSuggestions}
            replyPreview={telegramSnapshot.replyPreview}
            sendBehavior={state.config.userConfig?.keyboard.sendBehavior ?? 'enter'}
            target={telegramComposerTarget}
            voiceRecorderState={telegramSnapshot.voiceRecorderState}
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
        onCopyTelegramMessage={handleTelegramContextCopy}
        onDeleteTelegramMessage={handleTelegramContextDelete}
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
        telegramImagePreviewMeta={telegramSnapshot?.imagePreviewMeta ?? null}
        telegramImagePreviewUrl={telegramSnapshot?.imagePreviewUrl ?? null}
      />
    </div>
  );
};
