import '../index.css';
import type {
  AuthStartResult,
  ChatMessage,
  ChatSummary,
  ConnectorUpdateEvent,
  ConnectorStatus,
} from '../shared/connectors';
import type { AppActivity, AppMode, NetworkDefinition, NetworkId } from '../shared/types';
import { renderStatusToast } from './components/statusToast';
import {
  checkpointInDetails,
  clearInstagramCooldownUntil,
  formatCooldownRemaining,
  getInstagramCheckpointCooldownUntil,
  readInstagramCooldownUntil,
  writeInstagramCooldownUntil,
} from './features/instagram/cooldown';
import { createTelegramCallCard, describeTelegramCall } from './features/telegram/calls';
import { buildLinkedTextNodes } from './features/telegram/links';
import {
  buildVoiceBarHeights,
  createTelegramAttachmentId,
  extractLocalMediaPath,
  formatTelegramAttachmentMeta,
  formatTelegramDocumentKind,
  formatTelegramDocumentSubtitle,
  getSupportedTelegramVoiceRecordingMimeType,
  getTelegramAttachmentKind,
  getTelegramMeaningfulAlbumCaption,
  getTelegramVoiceRecordingFileName,
  isTelegramAlbumEligibleMessage,
  isTelegramDocumentFallbackText,
  isTelegramImageFallbackText,
  isTelegramVideoFallbackText,
  readBlobAsDataUrl,
  readFileAsDataUrl,
  TELEGRAM_MAX_ATTACHMENTS,
  TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES,
  TELEGRAM_VOICE_RECORDING_MIN_DURATION_MS,
} from './features/telegram/media';
import type { PendingTelegramAttachment } from './features/telegram/media';
import {
  createTelegramChatListItem,
  getTelegramChatRenderSignature,
} from './features/telegram/chatList';
import { syncTelegramMessageListNodes } from './features/telegram/messageList';
import {
  createTelegramDocumentCard,
  createTelegramMessageFooter,
  createTelegramMessageReactions,
  createTelegramVoiceNoteNodes,
} from './features/telegram/messageNodes';
import { getTelegramMessageRenderSignature } from './features/telegram/messageRender';
import {
  buildTelegramEmojiSuggestions,
  getTelegramEmojiTokenMatch,
  type TelegramEmojiSuggestion,
} from './lib/emoji';
import {
  formatChatTimestamp,
  formatDuration,
  formatFullDateTime,
  formatMessageDayLabel,
  formatMessageTimestamp,
  formatTelegramUnreadBadge,
  hasValidTimestamp,
  safeLabel,
  safeText,
} from './lib/format';
import { applyUserTheme } from './lib/theme';
import type {
  BootLegacyAppOptions,
  LegacyAppBridgeApi,
  LegacyAppSnapshot,
  LegacyCommandItem,
} from './legacyBridge';
import { AsyncLruCache } from './services/mediaCache';
import { beginMeasure } from './services/performance';
import { resolveRefreshDelay, shouldRefreshActiveMessages } from './services/refreshScheduler';
import { InstagramController } from './services/instagramController';
import { TelegramController } from './services/telegramController';

interface AppState {
  mode: AppMode;
  selectedNetwork: NetworkId;
  activeNetwork: NetworkId;
  sidebarCollapsed: boolean;
  vimPane:
    | 'networks'
    | 'telegram-chats'
    | 'telegram-messages'
    | 'instagram-chats'
    | 'instagram-messages';
  commandPaletteOpen: boolean;
  commandQuery: string;
  loading: Record<NetworkId, boolean>;
  connectorStatuses: Record<NetworkId, ConnectorStatus>;
  telegramChats: ChatSummary[];
  telegramMessages: ChatMessage[];
  activeTelegramChatId: string | null;
  selectedTelegramChatId: string | null;
  selectedTelegramMessageId: string | null;
  replyingToMessageId: string | null;
  replyingToSender: string | null;
  pendingTelegramAttachments: PendingTelegramAttachment[];
  telegramLoading: boolean;
  telegramMessagesLoading: boolean;
  telegramLoadError: string | null;
  telegramSearchQuery: string;
  telegramChatListMinimized: boolean;
  instagramChats: ChatSummary[];
  instagramMessages: ChatMessage[];
  activeInstagramChatId: string | null;
  selectedInstagramChatId: string | null;
  selectedInstagramMessageId: string | null;
  replyingToInstagramMessageId: string | null;
  replyingToInstagramSender: string | null;
  instagramLoading: boolean;
  instagramSearchQuery: string;
}

type AppCommand = {
  id: string;
  label: string;
  group: LegacyCommandItem['group'];
  run: () => void;
};

type RenderableTelegramMessage = ChatMessage & {
  pendingState?: 'sending';
};

type PendingTelegramMessage = RenderableTelegramMessage & {
  pendingState: 'sending';
  chatId: string;
  signature: string;
};

type TelegramEmojiCompletionState = {
  visible: boolean;
  query: string;
  tokenStart: number;
  tokenEnd: number;
  activeIndex: number;
  suggestions: TelegramEmojiSuggestion[];
};

type TelegramContextMenuState = {
  visible: boolean;
  messageId: string | null;
  x: number;
  y: number;
};

type TelegramForwardState = {
  visible: boolean;
  messageId: string | null;
  fromChatId: string | null;
  query: string;
  sending: boolean;
};

type AuthPromptState = {
  title: string;
  message: string;
  placeholder: string;
  label: string;
  stepLabel: string | null;
  secret: boolean;
  trim: boolean;
  submitLabel: string;
  onCancel?: () => void | Promise<void>;
};

type QrAuthState = {
  network: NetworkId;
  passwordRequired: boolean;
  qrLink: string | null;
};

const TELEGRAM_CONTEXT_MENU_GUARD_MS = 400;
const TELEGRAM_MESSAGES_PAGE_SIZE = 80;
const NETWORK_RAIL_VISIBLE = false;
export const bootLegacyApp = async (
  mountRoot?: HTMLDivElement,
  options: BootLegacyAppOptions = {},
): Promise<void> => {
  const appEl = mountRoot ?? document.querySelector<HTMLDivElement>('#app');
  if (!appEl) {
    throw new Error('App root not found');
  }

  const appConfig = await window.pelec.getConfig();
  applyUserTheme(appConfig.userConfig);
  const initialStatuses = await window.pelec.getConnectorStatuses();
  const instagramEnabled = appConfig.networks.some((network) => network.id === 'instagram');

  if (appConfig.networks.length < 1) {
    throw new Error('No networks configured');
  }

  const firstNetwork = appConfig.networks[0].id;

  const statusMap = Object.fromEntries(
    initialStatuses.map((status) => [status.network, status]),
  ) as Record<NetworkId, ConnectorStatus>;

  const state: AppState = {
    mode: 'normal',
    selectedNetwork: firstNetwork,
    activeNetwork: firstNetwork,
    sidebarCollapsed: true,
    vimPane: 'networks',
    commandPaletteOpen: false,
    commandQuery: '',
    loading: Object.fromEntries(
      appConfig.networks.map((network) => [network.id, true]),
    ) as Record<NetworkId, boolean>,
    connectorStatuses: statusMap,
    telegramChats: [],
    telegramMessages: [],
    activeTelegramChatId: null,
    selectedTelegramChatId: null,
    selectedTelegramMessageId: null,
    replyingToMessageId: null,
    replyingToSender: null,
    pendingTelegramAttachments: [],
    telegramLoading: false,
    telegramMessagesLoading: false,
    telegramLoadError: null,
    telegramSearchQuery: '',
    telegramChatListMinimized: false,
    instagramChats: [],
    instagramMessages: [],
    activeInstagramChatId: null,
    selectedInstagramChatId: null,
    selectedInstagramMessageId: null,
    replyingToInstagramMessageId: null,
    replyingToInstagramSender: null,
    instagramLoading: false,
    instagramSearchQuery: '',
  };

  const snapshotListeners = new Set<(snapshot: LegacyAppSnapshot) => void>();
  const bridge = options.bridge;
  const useReactTelegramMessageList = !!bridge;

  const mapVimPaneToAppPane = (): LegacyAppSnapshot['activePane'] => {
    if (
      state.mode === 'insert' &&
      state.activeNetwork === 'telegram' &&
      activeTelegramChatCanSend()
    ) {
      return 'telegram-composer';
    }

    return state.vimPane;
  };

  const activeTelegramChatCanSend = (): boolean =>
    !!state.activeTelegramChatId &&
    (state.telegramChats.find((chat) => chat.id === state.activeTelegramChatId)?.canSend ?? true);

  const areTelegramMessagesVisible = (): boolean =>
    !useReactTelegramMessageList || reactTelegramMessagesVisible;

  const getExposedTelegramChatId = (): string | null =>
    state.activeNetwork === 'telegram' && areTelegramMessagesVisible() ? state.activeTelegramChatId : null;

  const syncTelegramActiveChatExposure = (): void => {
    const nextExposedTelegramChatId = getExposedTelegramChatId();
    if (lastExposedTelegramChatId === nextExposedTelegramChatId) {
      return;
    }

    lastExposedTelegramChatId = nextExposedTelegramChatId;
    void window.pelec.setConnectorActiveChat('telegram', nextExposedTelegramChatId);
  };

  const getSnapshot = (): LegacyAppSnapshot => ({
    authPrompt: authPromptState
      ? {
          label: authPromptState.label,
          message: authPromptState.message,
          placeholder: authPromptState.placeholder,
          secret: authPromptState.secret,
          stepLabel: authPromptState.stepLabel,
          submitLabel: authPromptState.submitLabel,
          title: authPromptState.title,
          visible: true,
        }
      : null,
    mode: state.mode,
    activeNetwork: state.activeNetwork,
    activePane: mapVimPaneToAppPane(),
    qrAuth: qrAuthState
      ? {
          network: qrAuthState.network,
          passwordRequired: qrAuthState.passwordRequired,
          qrLink: qrAuthState.qrLink,
          visible: true,
        }
      : null,
    telegram: {
      activeChatTitle: safeLabel(
        state.telegramChats.find((chat) => chat.id === state.activeTelegramChatId)?.title,
        'Telegram',
      ),
      activeChatId: state.activeTelegramChatId,
      activeChatCanSend: activeTelegramChatCanSend(),
      chatListMinimized: state.telegramChatListMinimized,
      contextMenu: { ...telegramContextMenuState },
      draftText: telegramComposeInput.value,
      filteredChats: filterChatsByQuery(state.telegramChats, state.telegramSearchQuery),
      forward: {
        candidates: getTelegramForwardCandidates(),
        query: telegramForwardState.query,
        sending: telegramForwardState.sending,
        visible: telegramForwardState.visible,
      },
      hasOlderMessages: telegramHasOlderMessages,
      imagePreviewUrl: activeTelegramImageUrl,
      loadError: state.telegramLoadError,
      loadingOlderMessages: telegramLoadingOlderMessages,
      loading: state.telegramLoading,
      messageLoadError: state.telegramLoadError,
      messages: getVisibleTelegramMessages(),
      messagesLoading: state.telegramMessagesLoading,
      pendingAttachments: [...state.pendingTelegramAttachments],
      replyPreview: getTelegramReplyPreview(),
      searchQuery: state.telegramSearchQuery,
      selectedChatId: state.selectedTelegramChatId,
      selectedMessageId: state.selectedTelegramMessageId,
      voiceRecorderState: telegramVoiceRecorder
        ? 'recording'
        : telegramVoiceRecorderBusyReason === 'preparing'
          ? 'preparing'
          : telegramVoiceRecorderBusyReason === 'sending'
            ? 'sending'
          : getSupportedTelegramVoiceRecordingMimeType()
            ? 'idle'
            : 'unsupported',
    },
  });

  const emitSnapshotChange = (): void => {
    const snapshot = getSnapshot();
    bridge?.onSnapshotChange?.(snapshot);
    for (const listener of snapshotListeners) {
      listener(snapshot);
    }
  };

  const commandPalette = document.createElement('div');
  commandPalette.className = 'command-palette hidden';

  const commandInput = document.createElement('input');
  commandInput.className = 'command-input';
  commandInput.placeholder = 'Type command, e.g. switch telegram';
  commandPalette.append(commandInput);

  const commandList = document.createElement('div');
  commandList.className = 'command-list';
  commandPalette.append(commandList);

  appEl.innerHTML = `
  <div class="app-frame">
    <div class="shell">
      <aside class="sidebar" aria-label="Networks">
        <div class="search-wrap">
          <input id="quick-filter" class="quick-filter" placeholder="/ to search networks" />
        </div>
        <nav id="network-list" class="network-list"></nav>
      </aside>
      <main class="content" aria-live="polite">
        <section id="views" class="views"></section>
      </main>
    </div>
  </div>
  `;

  appEl.append(commandPalette);
  const statusBar = document.createElement('div');
  statusBar.id = 'status';
  statusBar.className = 'status-live-region';
  statusBar.setAttribute('aria-live', 'polite');
  appEl.append(statusBar);
  const statusToastHost = document.createElement('div');
  statusToastHost.className = 'status-toast-host hidden';
  appEl.append(statusToastHost);

  const networkList = document.querySelector<HTMLElement>('#network-list');
  const shellEl = document.querySelector<HTMLElement>('.shell');
  const views = document.querySelector<HTMLElement>('#views');
  const quickFilter = document.querySelector<HTMLInputElement>('#quick-filter');

  if (
    !networkList ||
    !shellEl ||
    !views ||
    !quickFilter
  ) {
    throw new Error('Required UI elements missing');
  }

  shellEl.tabIndex = -1;

  const webviewMap = new Map<NetworkId, Electron.WebviewTag>();
  const telegramController = new TelegramController();
  const instagramController = new InstagramController();
  const telegramAudioUrlCache = new AsyncLruCache<string | undefined>(96);
  const telegramVideoUrlCache = new AsyncLruCache<string | undefined>(64);
  let telegramChatsVersion = 0;
  let telegramMessagesVersion = 0;
  const pendingTelegramMessagesByChat = new Map<string, PendingTelegramMessage[]>();
  let lastRenderedTelegramChatId: string | null = null;
  let lastRenderedTelegramChatsVersion = -1;
  let lastRenderedTelegramMessagesVersion = -1;
  let lastRenderedTelegramSearchQuery = '';
  let lastRenderedTelegramActiveChatButtonId: string | null = null;
  let lastRenderedTelegramSelectedChatId: string | null = null;
  let lastRenderedTelegramChatPane: AppState['vimPane'] | null = null;
  let lastRenderedTelegramSelectedMessageId: string | null = null;
  let lastRenderedTelegramMessagePane: AppState['vimPane'] | null = null;
  let telegramForceScrollBottom = false;
  let telegramChatsRefreshTimer: number | null = null;
  let telegramMessagesRefreshTimer: number | null = null;
  let telegramMessagesHydrationTimer: number | null = null;
  let telegramScrollFollowupTimer: number | null = null;
  let telegramReadAcknowledgeTimer: number | null = null;
  let lastTelegramReadAcknowledgeKey: string | null = null;
  let telegramHasOlderMessages = false;
  let telegramLoadingOlderMessages = false;
  let reactTelegramMessagesVisible = !useReactTelegramMessageList;
  let lastExposedTelegramChatId: string | null | undefined;
  let instagramChatsRefreshTimer: number | null = null;
  let instagramMessagesRefreshTimer: number | null = null;
  let telegramBackgroundRefreshTimer: number | null = null;
  let instagramBackgroundRefreshTimer: number | null = null;
  let instagramWebFallbackMonitorTimer: number | null = null;
  let telegramNotificationScanInFlight = false;
  let instagramNotificationScanInFlight = false;
  let windowHasFocus = document.hasFocus();
  let documentVisible = document.visibilityState === 'visible';
  let instagramCheckpointCooldownUntil = readInstagramCooldownUntil();
  let statusActivity: AppActivity | null = null;
  let statusActivityClearTimer: number | null = null;
  type NotificationCursor = {
    latestMessageId: string;
    latestTimestamp: number;
  };
  type InstagramWebFallbackState = {
    unreadCount: number;
    preview?: string;
    signature?: string;
  };

  const notificationCursorByChat = new Map<string, NotificationCursor>();
  const lastUnreadCountByChat = new Map<string, number>();
  const notificationBaselineReady: Record<NetworkId, boolean> = {
    telegram: false,
    instagram: false,
  };
  let lastInstagramWebFallbackState: InstagramWebFallbackState | null = null;
  let lastInstagramWebFallbackNotificationKey: string | null = null;
  const renderedTelegramChatButtonById = new Map<string, HTMLButtonElement>();
  const renderedTelegramChatSignatureById = new Map<string, string>();
  const renderedTelegramMessageNodeById = new Map<string, HTMLElement>();
  const renderedTelegramMessageBundleById = new Map<
    string,
    { nodes: HTMLElement[]; signature: string }
  >();
  let telegramEmojiCompletionState: TelegramEmojiCompletionState = {
    visible: false,
    query: '',
    tokenStart: 0,
    tokenEnd: 0,
    activeIndex: 0,
    suggestions: [],
  };

  const buildChatKey = (network: NetworkId, chatId: string): string => `${network}:${chatId}`;

  const compareNotificationMessageIds = (a: string, b: string): number => {
    try {
      const aInt = BigInt(a);
      const bInt = BigInt(b);
      if (aInt < bInt) {
        return -1;
      }
      if (aInt > bInt) {
        return 1;
      }
      return 0;
    } catch {
      return a.localeCompare(b);
    }
  };

  const compareNotificationCursorToMessage = (
    cursor: NotificationCursor,
    message: ChatMessage,
  ): number => {
    if (cursor.latestTimestamp !== message.timestamp) {
      return cursor.latestTimestamp - message.timestamp;
    }
    return compareNotificationMessageIds(cursor.latestMessageId, message.id);
  };

  const resetNotificationTracking = (network: NetworkId): void => {
    notificationBaselineReady[network] = false;
    for (const key of notificationCursorByChat.keys()) {
      if (key.startsWith(`${network}:`)) {
        notificationCursorByChat.delete(key);
      }
    }
    for (const key of lastUnreadCountByChat.keys()) {
      if (key.startsWith(`${network}:`)) {
        lastUnreadCountByChat.delete(key);
      }
    }
  };

  const scheduleTelegramScrollToBottom = (): void => {
    telegramMessageListEl.scrollTop = telegramMessageListEl.scrollHeight;
    if (telegramScrollFollowupTimer !== null) {
      window.clearTimeout(telegramScrollFollowupTimer);
    }
    telegramScrollFollowupTimer = window.setTimeout(() => {
      telegramScrollFollowupTimer = null;
      telegramMessageListEl.scrollTop = telegramMessageListEl.scrollHeight;
      scheduleTelegramReadAcknowledgement();
    }, 120);
  };

  const isChatCurrentlyVisible = (network: NetworkId, chatId: string): boolean => {
    if (!document.hasFocus()) {
      return false;
    }
    if (state.activeNetwork !== network) {
      return false;
    }
    if (network === 'telegram') {
      return state.activeTelegramChatId === chatId;
    }
    if (network === 'instagram') {
      return state.activeInstagramChatId === chatId;
    }
    return false;
  };

  const buildNotificationPreview = (message: ChatMessage): string => {
    const sender = safeLabel(message.sender, 'Unknown');
    const text = safeText(message.text).trim();
    const textLower = text.toLowerCase();
    if (message.call) {
      return `${sender}: [${describeTelegramCall(message.call, message.outgoing).preview}]`;
    }
    if (message.stickerUrl && (textLower === 'sticker' || textLower.startsWith('sticker '))) {
      return `${sender}: [sticker${message.stickerEmoji ? ` ${message.stickerEmoji}` : ''}]`;
    }
    if (message.animationUrl && (textLower === 'gif/animation' || textLower === '[media]' || textLower === '[media_share]' || textLower === '[video]')) {
      return `${sender}: [animation]`;
    }
    if (text) {
      return `${sender}: ${text}`;
    }
    if (message.imageUrl) {
      return `${sender}: [image]`;
    }
    if (message.animationUrl) {
      return `${sender}: [animation]`;
    }
    if (message.stickerUrl) {
      return `${sender}: [sticker${message.stickerEmoji ? ` ${message.stickerEmoji}` : ''}]`;
    }
    if (message.hasAudio || message.audioUrl) {
      return `${sender}: [voice message]`;
    }
    return `${sender}: [message]`;
  };

  const maybeNotifyNewMessages = (
    network: NetworkId,
    chatId: string,
    chatTitle: string,
    messages: ChatMessage[],
    suppressNotification = false,
  ): void => {
    const key = buildChatKey(network, chatId);
    const latestMessage = messages[messages.length - 1];
    if (!latestMessage) {
      return;
    }

    const cursor = notificationCursorByChat.get(key);
    if (!cursor) {
      notificationCursorByChat.set(key, {
        latestMessageId: latestMessage.id,
        latestTimestamp: latestMessage.timestamp,
      });
      return;
    }

    let unseenIncoming: ChatMessage[] = [];
    const previousLatestIndex = messages.findIndex(
      (message) =>
        message.id === cursor.latestMessageId && message.timestamp === cursor.latestTimestamp,
    );

    if (previousLatestIndex >= 0) {
      unseenIncoming = messages.slice(previousLatestIndex + 1).filter((message) => !message.outgoing);
    } else {
      unseenIncoming = messages.filter(
        (message) =>
          !message.outgoing && compareNotificationCursorToMessage(cursor, message) < 0,
      );
    }

    if (compareNotificationCursorToMessage(cursor, latestMessage) < 0) {
      notificationCursorByChat.set(key, {
        latestMessageId: latestMessage.id,
        latestTimestamp: latestMessage.timestamp,
      });
    }

    if (
      suppressNotification ||
      unseenIncoming.length < 1 ||
      isChatCurrentlyVisible(network, chatId) ||
      isNotificationsMutedForChat(network, chatId)
    ) {
      return;
    }

    const networkLabel = network === 'telegram' ? 'Telegram' : 'Instagram';
    const title = `${networkLabel} • ${chatTitle || 'New message'}`;
    const body =
      unseenIncoming.length === 1
        ? buildNotificationPreview(unseenIncoming[0])
        : `${unseenIncoming.length} new messages`;
    void window.pelec.showNotification(title, body);
  };

  const isWebFallbackVisible = (network: NetworkId): boolean =>
    document.hasFocus() && state.activeNetwork === network;

  const isNotificationsMutedForChat = (network: NetworkId, chatId: string): boolean => {
    if (network !== 'telegram') {
      return false;
    }
    return state.telegramChats.find((chat) => chat.id === chatId)?.isMuted === true;
  };

  const parseUnreadCountFromTitle = (title: string): number => {
    const match = title.match(/^\((\d+)\)/);
    if (!match) {
      return 0;
    }
    return Number(match[1]) || 0;
  };

  const sanitizeInstagramNotificationText = (value: string | null | undefined): string =>
    String(value ?? '')
      .replace(/[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const isUsefulInstagramText = (value: string | null | undefined): boolean => {
    const text = sanitizeInstagramNotificationText(value);
    const lowered = text.toLowerCase();
    if (!text) {
      return false;
    }
    if (lowered === 'instagram') {
      return false;
    }
    if (text === '.' || text === ',' || text === '•') {
      return false;
    }
    if (/^[.:,;!?-]+$/.test(text)) {
      return false;
    }
    if (
      lowered === 'message' ||
      lowered === 'messages' ||
      lowered === 'new message' ||
      lowered === 'new messages' ||
      lowered === 'send message' ||
      lowered === 'messaging' ||
      lowered === 'chats' ||
      lowered === 'notes' ||
      lowered === 'requests' ||
      lowered === 'search'
    ) {
      return false;
    }
    return true;
  };

  const isInstagramTransientPreview = (value: string | null | undefined): boolean => {
    const text = sanitizeInstagramNotificationText(value);
    if (!text) {
      return false;
    }
    const previewText = text.includes(':')
      ? sanitizeInstagramNotificationText(text.slice(text.indexOf(':') + 1))
      : text;
    return /^(typing(?:\.{3}|…)?|active(?: now)?|online|recording voice message(?:\.{3}|…)?)$/i.test(
      previewText,
    );
  };

  const isInstagramMetadataText = (value: string | null | undefined): boolean => {
    const text = sanitizeInstagramNotificationText(value);
    if (!text) {
      return false;
    }
    return (
      /^\d+$/.test(text) ||
      /^(?:now|yesterday)$/i.test(text) ||
      /^\d+\s*(?:s|m|h|d|w|mo|yr)s?$/i.test(text) ||
      /^(?:seen|sent|delivered|read)$/i.test(text) ||
      isInstagramTransientPreview(text)
    );
  };

  const isUsefulInstagramPreview = (value: string | null | undefined): boolean => {
    const text = sanitizeInstagramNotificationText(value);
    const lowered = text.toLowerCase();
    if (!isUsefulInstagramText(text) || isInstagramTransientPreview(text)) {
      return false;
    }
    if (text.startsWith('.') || text.startsWith('•') || text.startsWith(',')) {
      return false;
    }
    if (
      lowered === '. message' ||
      lowered === '. messages' ||
      lowered === 'instagram . message' ||
      lowered === 'instagram . messages'
    ) {
      return false;
    }
    if (/^[^a-zA-Z0-9]*message(s)?$/.test(lowered)) {
      return false;
    }
    return true;
  };

  const isInstagramTitleStatusText = (value: string | null | undefined): boolean => {
    const text = sanitizeInstagramNotificationText(value);
    if (!text) {
      return false;
    }
    return /\s[•·]\s(?:now|yesterday|\d+\s*(?:s|m|h|d|w|mo|yr)s?)$/i.test(text);
  };

  const buildInstagramWebFallbackNotification = (
    nextState: InstagramWebFallbackState,
    previousState: InstagramWebFallbackState,
  ): { title: string; body: string } => {
    const preview = sanitizeInstagramNotificationText(nextState.preview);
    if (preview) {
      const separatorIndex = preview.indexOf(':');
      if (separatorIndex > 0) {
        const sender = sanitizeInstagramNotificationText(preview.slice(0, separatorIndex));
        const body = sanitizeInstagramNotificationText(preview.slice(separatorIndex + 1));
        if (sender && body) {
          return {
            title: `Instagram • ${sender}`,
            body,
          };
        }
      }
      return {
        title: 'Instagram',
        body: preview,
      };
    }

    const delta = Math.max(1, nextState.unreadCount - previousState.unreadCount);
    return {
      title: 'Instagram',
      body: delta === 1 ? 'New Instagram message' : `${delta} new Instagram messages`,
    };
  };

  const buildInstagramWebFallbackNotificationKey = (
    unreadCount: number,
    payload: { title: string; body: string },
  ): string =>
    `${unreadCount}::${sanitizeInstagramNotificationText(payload.title)}::${sanitizeInstagramNotificationText(payload.body)}`;

  const readInstagramWebFallbackState = async (
    view: Electron.WebviewTag,
  ): Promise<{ unreadCount: number; preview?: string; signature?: string } | null> => {
    try {
      const result = await view.executeJavaScript(
        `
          (() => {
            const title = typeof document.title === 'string' ? document.title.trim() : '';
            const normalize = (value) =>
              String(value || '')
                .replace(/[\\p{Cc}\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]/gu, '')
                .replace(/\\s+/g, ' ')
                .trim();

            const isTransientStatus = (value) =>
              /^(typing(?:\\.{3}|…)?|active(?: now)?|online|recording voice message(?:\\.{3}|…)?)$/i.test(
                normalize(value),
              );

            const isMetadataText = (value) => {
              const text = normalize(value);
              if (!text) {
                return false;
              }
              return (
                /^\\d+$/.test(text) ||
                /^(?:now|yesterday)$/i.test(text) ||
                /^\\d+\\s*(?:s|m|h|d|w|mo|yr)s?$/i.test(text) ||
                /^(?:seen|sent|delivered|read)$/i.test(text) ||
                isTransientStatus(text)
              );
            };

            const isUsefulText = (value) => {
              const text = normalize(value);
              const lowered = text.toLowerCase();
              if (!text) {
                return false;
              }
              if (isTransientStatus(text)) {
                return false;
              }
              if (lowered === 'instagram') {
                return false;
              }
              if (text === '.' || text === ',' || text === '•') {
                return false;
              }
              if (/^[.:,;!?-]+$/.test(text)) {
                return false;
              }
              if (
                lowered === 'message' ||
                lowered === 'messages' ||
                lowered === 'new message' ||
                lowered === 'new messages' ||
                lowered === 'send message' ||
                lowered === 'messaging' ||
                lowered === 'chats' ||
                lowered === 'notes' ||
                lowered === 'requests' ||
                lowered === 'search'
              ) {
                return false;
              }
              return true;
            };

            const isUsefulPreview = (value) => {
              const text = normalize(value);
              const lowered = text.toLowerCase();
              if (!isUsefulText(text)) {
                return false;
              }
              if (text.startsWith('.') || text.startsWith('•') || text.startsWith(',')) {
                return false;
              }
              if (
                lowered === 'message' ||
                lowered === 'messages' ||
                lowered === '. message' ||
                lowered === '. messages' ||
                lowered === 'instagram . message' ||
                lowered === 'instagram . messages'
              ) {
                return false;
              }
              if (/^[^a-zA-Z0-9]*message(s)?$/.test(lowered)) {
                return false;
              }
              return true;
            };

            const stripSenderPrefix = (sender, value) => {
              const normalizedSender = normalize(sender);
              const text = normalize(value);
              if (!normalizedSender || !text) {
                return text;
              }
              if (!text.toLowerCase().startsWith(normalizedSender.toLowerCase())) {
                return text;
              }
              return text
                .slice(normalizedSender.length)
                .replace(/^[\\s:\\-•.,]+/, '')
                .trim();
            };

            const cleanSenderText = (value) => {
              let text = normalize(value);
              if (!text) {
                return '';
              }

              text = text
                .replace(/^(?:active(?: now)?|online|typing(?:\\.{3}|…)?)[\\s:\\-•.,]*/i, '')
                .trim();

              const segments = text.split(/\\s+[•·]\\s+/).map((entry) => normalize(entry)).filter(Boolean);
              if (segments.length > 1 && isMetadataText(segments[segments.length - 1])) {
                segments.pop();
                text = segments.join(' • ').trim();
              }

              return text.trim();
            };

            const titlePreview = normalize(title.replace(/^\\(\\d+\\)\\s*/, ''));

            const isUnreadCandidate = (element) => {
              if (!(element instanceof HTMLElement)) {
                return false;
              }
              const style = window.getComputedStyle(element);
              const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
              return fontWeight >= 600 || style.fontWeight === 'bold';
            };

            const getInboxRows = () =>
              Array.from(
                document.querySelectorAll('a[href*="/direct/t/"], div[role="link"], div[role="button"], li'),
              ).filter((row) => {
                if (!(row instanceof HTMLElement)) {
                  return false;
                }
                const rect = row.getBoundingClientRect();
                return !(
                  rect.width < 120 ||
                  rect.height < 36 ||
                  rect.top < 0 ||
                  rect.top > window.innerHeight ||
                  rect.left > window.innerWidth * 0.7
                );
              });

            const describeRow = (row) => {
              if (!(row instanceof HTMLElement)) {
                return null;
              }

              const textNodes = Array.from(row.querySelectorAll('span, div, p'))
                .filter((node) => node instanceof HTMLElement)
                .map((node) => {
                  const element = node;
                  const style = window.getComputedStyle(element);
                  const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
                  return {
                    text: normalize(element.textContent),
                    unread: isUnreadCandidate(element),
                    bold: fontWeight >= 600 || style.fontWeight === 'bold',
                  };
                })
                .filter((entry) => isUsefulText(entry.text));

              if (textNodes.length < 1) {
                return null;
              }

              const unreadTexts = textNodes
                .filter((entry) => entry.unread)
                .map((entry) => entry.text)
                .filter((text, index, array) => array.indexOf(text) === index);

              const boldTexts = textNodes
                .filter((entry) => entry.bold)
                .map((entry) => entry.text)
                .filter((text, index, array) => array.indexOf(text) === index);

              const allTexts = textNodes
                .map((entry) => entry.text)
                .filter((text, index, array) => array.indexOf(text) === index);

              const unreadBadge = allTexts.find((text) => /^\\d+$/.test(text));
              const rowLooksUnread = unreadTexts.length > 0 || Boolean(unreadBadge);

              if (!rowLooksUnread && allTexts.length < 2) {
                return null;
              }

              const contentTexts = allTexts.filter((text) => !isMetadataText(text));
              const senderCandidates = [
                ...unreadTexts.filter((text) => !isMetadataText(text)),
                ...boldTexts.filter((text) => !isMetadataText(text)),
                ...contentTexts,
              ]
                .map((text) => cleanSenderText(text))
                .filter((text, index, array) => Boolean(text) && array.indexOf(text) === index);
              const sender = senderCandidates[0] || '';
              const messageCandidates = [
                ...unreadTexts.filter((text) => text !== sender && !isMetadataText(text)),
                ...contentTexts.filter((text) => text !== sender),
              ];
              const message = messageCandidates.find((text) => {
                const next = stripSenderPrefix(sender, text);
                return Boolean(next) && !isMetadataText(next) && isUsefulPreview(next);
              }) || '';
              const ariaLabel = normalize(row.getAttribute('aria-label'));

              let preview = '';
              if (sender && message) {
                const cleanedMessage = stripSenderPrefix(sender, message);
                if (cleanedMessage && isUsefulPreview(cleanedMessage)) {
                  preview = sender + ': ' + cleanedMessage;
                }
              }

              if (!preview && sender && isUsefulText(ariaLabel) && ariaLabel !== sender) {
                const cleanedAria = stripSenderPrefix(sender, ariaLabel);
                if (cleanedAria && !isMetadataText(cleanedAria) && isUsefulPreview(cleanedAria)) {
                  preview = sender + ': ' + cleanedAria;
                }
              }

              const signatureParts = [];
              if (rowLooksUnread) {
                signatureParts.push('u=1');
              }
              if (sender) {
                signatureParts.push('s=' + sender);
              }
              if (preview) {
                signatureParts.push('p=' + preview);
              }
              if (unreadBadge) {
                signatureParts.push('b=' + unreadBadge);
              }
              if (signatureParts.length < 1) {
                return null;
              }

              return {
                unread: rowLooksUnread,
                preview,
                signature: signatureParts.join('|'),
              };
            };

            const extractInboxSignature = () => {
              const descriptions = getInboxRows()
                .map((row) => describeRow(row))
                .filter(Boolean)
                .slice(0, 8);
              return descriptions.map((entry) => entry.signature).join(' || ');
            };

            const extractThreadPreview = () => {
              const descriptions = getInboxRows()
                .map((row) => describeRow(row))
                .filter(Boolean);
              const unreadPreview = descriptions.find((entry) => entry.unread && entry.preview);
              if (unreadPreview && isUsefulPreview(unreadPreview.preview)) {
                return unreadPreview.preview;
              }
              const firstPreview = descriptions.find((entry) => entry.preview);
              return firstPreview?.preview || '';
            };

            return {
              title,
              titlePreview,
              rowPreview: extractThreadPreview(),
              signature: extractInboxSignature(),
            };
          })();
        `,
        true,
      ) as { title?: string; titlePreview?: string; rowPreview?: string; signature?: string } | undefined;

      const title = result?.title?.trim() ?? '';
      const unreadCount = parseUnreadCountFromTitle(title);
      const titlePreview = sanitizeInstagramNotificationText(result?.titlePreview);
      const rowPreview = sanitizeInstagramNotificationText(result?.rowPreview);
      const signature = sanitizeInstagramNotificationText(result?.signature);
      const previewFromRow =
        rowPreview && isUsefulInstagramPreview(rowPreview)
          ? rowPreview
          : undefined;
      const previewFromTitle =
        titlePreview &&
        !isInstagramMetadataText(titlePreview) &&
        !isInstagramTitleStatusText(titlePreview) &&
        isUsefulInstagramPreview(titlePreview)
          ? titlePreview
          : undefined;
      const preview = previewFromRow || previewFromTitle;
      return { unreadCount, preview, signature: signature || undefined };
    } catch (error) {
      console.warn('Failed to inspect Instagram web fallback title.', error);
      return null;
    }
  };

  const pollInstagramWebFallbackNotifications = async (): Promise<void> => {
    if (!instagramEnabled) {
      return;
    }
    const instagramStatus = getStatusByNetwork('instagram');
    if (instagramStatus.mode !== 'web-fallback') {
      lastInstagramWebFallbackState = null;
      lastInstagramWebFallbackNotificationKey = null;
      return;
    }

    const view = webviewMap.get('instagram');
    if (!view) {
      return;
    }

    const nextState = await readInstagramWebFallbackState(view);
    if (nextState === null) {
      return;
    }
    const previousState = lastInstagramWebFallbackState;
    if (previousState === null) {
      lastInstagramWebFallbackState = nextState;
      return;
    }

    if (nextState.unreadCount < previousState.unreadCount || nextState.unreadCount === 0) {
      lastInstagramWebFallbackNotificationKey = null;
    }

    const unreadIncreased = nextState.unreadCount > previousState.unreadCount;
    const previewChanged =
      Boolean(nextState.preview) && nextState.preview !== previousState.preview;
    const signatureChanged =
      Boolean(nextState.signature) && nextState.signature !== previousState.signature;
    const inboxMeaningfullyChanged =
      nextState.unreadCount > 0 &&
      nextState.unreadCount >= previousState.unreadCount &&
      (previewChanged || signatureChanged);

    if ((unreadIncreased || inboxMeaningfullyChanged) && !isWebFallbackVisible('instagram')) {
      const payload = buildInstagramWebFallbackNotification(nextState, previousState);
      const notificationKey = buildInstagramWebFallbackNotificationKey(
        nextState.unreadCount,
        payload,
      );
      if (notificationKey !== lastInstagramWebFallbackNotificationKey) {
        void window.pelec.showNotification(payload.title, payload.body);
        lastInstagramWebFallbackNotificationKey = notificationKey;
      }
    }

    lastInstagramWebFallbackState = nextState;
  };

  const ensureInstagramWebFallbackMonitor = (): void => {
    if (!instagramEnabled) {
      if (instagramWebFallbackMonitorTimer !== null) {
        window.clearInterval(instagramWebFallbackMonitorTimer);
        instagramWebFallbackMonitorTimer = null;
      }
      lastInstagramWebFallbackState = null;
      lastInstagramWebFallbackNotificationKey = null;
      return;
    }
    const instagramStatus = getStatusByNetwork('instagram');
    if (instagramStatus.mode !== 'web-fallback') {
      if (instagramWebFallbackMonitorTimer !== null) {
        window.clearInterval(instagramWebFallbackMonitorTimer);
        instagramWebFallbackMonitorTimer = null;
      }
      lastInstagramWebFallbackState = null;
      lastInstagramWebFallbackNotificationKey = null;
      return;
    }

    if (instagramWebFallbackMonitorTimer !== null) {
      return;
    }

    instagramWebFallbackMonitorTimer = window.setInterval(() => {
      void pollInstagramWebFallbackNotifications();
    }, 5000);
    void pollInstagramWebFallbackNotifications();
  };

  const fetchChatMessages = async (
    network: NetworkId,
    chatId: string,
  ): Promise<ChatMessage[]> =>
    window.pelec.listConnectorMessages(
      network,
      chatId,
      network === 'telegram' ? { passive: true } : undefined,
    );

  const scanChatsForNotifications = async (
    network: NetworkId,
    chats: ChatSummary[],
    activeChatId: string | null,
    suppressNotifications = false,
  ): Promise<void> => {
    const candidates = chats
      .filter((chat) => {
        if (chat.unreadCount < 1 || chat.isMuted || activeChatId === chat.id) {
          return false;
        }
        if (suppressNotifications) {
          return true;
        }
        const key = buildChatKey(network, chat.id);
        const previousUnreadCount = lastUnreadCountByChat.get(key) ?? 0;
        return chat.unreadCount > previousUnreadCount;
      })
      .sort((a, b) => b.unreadCount - a.unreadCount);

    for (const chat of candidates) {
      try {
        const messages = await fetchChatMessages(network, chat.id);
        maybeNotifyNewMessages(network, chat.id, chat.title, messages, suppressNotifications);
      } catch (error) {
        console.warn(`[${network}] notification scan failed for chat ${chat.id}`, error);
      }
    }

    for (const chat of chats) {
      lastUnreadCountByChat.set(buildChatKey(network, chat.id), chat.unreadCount);
    }
  };

  const isInstagramCheckpointCooldownActive = (): boolean => {
    if (!instagramCheckpointCooldownUntil) {
      return false;
    }
    if (Date.now() >= instagramCheckpointCooldownUntil) {
      instagramCheckpointCooldownUntil = 0;
      clearInstagramCooldownUntil();
      return false;
    }
    return true;
  };

  const setInstagramCheckpointCooldown = (reason: string): void => {
    const until = getInstagramCheckpointCooldownUntil();
    instagramCheckpointCooldownUntil = until;
    writeInstagramCooldownUntil(until);
    console.info('[instagram-auth][renderer] checkpoint cooldown enabled', {
      untilIso: new Date(until).toISOString(),
      reason,
    });
  };

  const nativeTelegram = document.createElement('div');
  nativeTelegram.className = 'native-telegram hidden';
  nativeTelegram.innerHTML = `
    <aside class="telegram-left-pane">
      <header class="telegram-left-header">
        <input class="telegram-search" placeholder="Search" />
      </header>
      <section id="telegram-chat-list" class="telegram-chat-list"></section>
    </aside>
    <section class="telegram-chat-pane">
      <header id="telegram-chat-title" class="telegram-chat-title">Telegram</header>
      <div id="telegram-message-list" class="telegram-message-list">
        <div id="telegram-message-legacy-root" class="telegram-message-root"></div>
        <div id="telegram-message-react-root" class="telegram-message-root"></div>
      </div>
      <footer class="telegram-composer">
        <div id="telegram-compose-react-root" class="telegram-compose-react-root"></div>
        <div id="telegram-compose-reply" class="telegram-compose-reply hidden">
          <div class="telegram-compose-reply-body">
            <div id="telegram-compose-reply-sender" class="telegram-compose-reply-sender"></div>
            <div id="telegram-compose-reply-text" class="telegram-compose-reply-text"></div>
          </div>
          <button
            id="telegram-compose-reply-close"
            class="telegram-compose-reply-close"
            type="button"
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
        <div id="telegram-compose-attachment" class="telegram-compose-attachment hidden"></div>
        <div
          id="telegram-emoji-completion"
          class="telegram-emoji-completion hidden"
          role="listbox"
          aria-label="Emoji suggestions"
        ></div>
        <div class="telegram-compose-row">
          <button id="telegram-attach-button" class="telegram-attach-button" type="button" aria-label="Attach file">+</button>
          <input id="telegram-attach-input" class="telegram-attach-input" type="file" multiple />
          <textarea id="telegram-compose-input" class="telegram-compose-input" placeholder="Message" rows="1"></textarea>
          <button id="telegram-voice-record-button" class="telegram-voice-record-button" type="button" aria-label="Hold to record a voice note" title="Hold to record a voice note">●</button>
          <button id="telegram-send-button" class="telegram-send-button" type="button">➤</button>
        </div>
      </footer>
    </section>
  `;
  views.append(nativeTelegram);

  const telegramChatListEl = nativeTelegram.querySelector<HTMLElement>('#telegram-chat-list');
  const telegramChatTitleEl = nativeTelegram.querySelector<HTMLElement>('#telegram-chat-title');
  const telegramMessageListEl = nativeTelegram.querySelector<HTMLElement>('#telegram-message-list');
  const telegramMessageLegacyRootEl = nativeTelegram.querySelector<HTMLElement>(
    '#telegram-message-legacy-root',
  );
  const telegramSearchInput = nativeTelegram.querySelector<HTMLInputElement>('.telegram-search');
  const telegramComposeReplyEl = nativeTelegram.querySelector<HTMLElement>('#telegram-compose-reply');
  const telegramComposeReplySenderEl = nativeTelegram.querySelector<HTMLElement>('#telegram-compose-reply-sender');
  const telegramComposeReplyTextEl = nativeTelegram.querySelector<HTMLElement>('#telegram-compose-reply-text');
  const telegramComposeReplyCloseEl = nativeTelegram.querySelector<HTMLButtonElement>(
    '#telegram-compose-reply-close',
  );
  const telegramComposerEl = nativeTelegram.querySelector<HTMLElement>('.telegram-composer');
  const telegramComposeAttachment = nativeTelegram.querySelector<HTMLElement>('#telegram-compose-attachment');
  const telegramEmojiCompletionEl = nativeTelegram.querySelector<HTMLElement>(
    '#telegram-emoji-completion',
  );
  const telegramAttachButton = nativeTelegram.querySelector<HTMLButtonElement>('#telegram-attach-button');
  const telegramAttachInput = nativeTelegram.querySelector<HTMLInputElement>('#telegram-attach-input');
  const telegramComposeInput = nativeTelegram.querySelector<HTMLTextAreaElement>('#telegram-compose-input');
  const telegramVoiceRecordButton = nativeTelegram.querySelector<HTMLButtonElement>(
    '#telegram-voice-record-button',
  );
  const telegramSendButton = nativeTelegram.querySelector<HTMLButtonElement>('#telegram-send-button');

  if (
    !telegramChatListEl ||
    !telegramChatTitleEl ||
    !telegramMessageListEl ||
    !telegramMessageLegacyRootEl ||
    !telegramSearchInput ||
    !telegramComposeReplyEl ||
    !telegramComposeReplySenderEl ||
    !telegramComposeReplyTextEl ||
    !telegramComposeReplyCloseEl ||
    !telegramComposerEl ||
    !telegramComposeAttachment ||
    !telegramEmojiCompletionEl ||
    !telegramAttachButton ||
    !telegramAttachInput ||
    !telegramComposeInput ||
    !telegramVoiceRecordButton ||
    !telegramSendButton
  ) {
    throw new Error('Native Telegram UI elements missing');
  }

  nativeTelegram.tabIndex = -1;
  telegramChatListEl.tabIndex = -1;
  telegramMessageListEl.tabIndex = -1;

  const focusTelegramPaneSurface = (
    pane: Extract<AppState['vimPane'], 'telegram-chats' | 'telegram-messages'>,
  ): void => {
    const target = pane === 'telegram-chats' ? telegramChatListEl : telegramMessageListEl;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== target) {
      activeElement.blur?.();
    }
    target.focus({ preventScroll: true });
  };

  const focusTelegramKeyboardSurface = (): void => {
    if (state.activeNetwork !== 'telegram' || state.mode === 'insert') {
      return;
    }

    if (state.vimPane === 'telegram-chats') {
      focusTelegramPaneSurface('telegram-chats');
      return;
    }

    focusTelegramPaneSurface('telegram-messages');
  };

  const focusAppKeyboardSurface = (): void => {
    if (state.activeNetwork === 'telegram') {
      focusTelegramKeyboardSurface();
      return;
    }

    shellEl.focus();
  };

  const scheduleTelegramKeyboardSurfaceFocus = (): void => {
    focusTelegramKeyboardSurface();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        focusTelegramKeyboardSurface();
      });
      return;
    }

    window.setTimeout(() => {
      focusTelegramKeyboardSurface();
    }, 0);
  };

  const setTelegramChatListMinimized = (minimized: boolean): void => {
    if (state.telegramChatListMinimized === minimized) {
      return;
    }
    state.telegramChatListMinimized = minimized;
    if (minimized) {
      telegramSearchInput.blur();
    }
    statusBar.textContent = minimized
      ? 'Telegram chats minimized.'
      : 'Telegram chats expanded.';
    render();
  };

  const toggleTelegramChatListMinimized = (): void => {
    if (state.activeNetwork !== 'telegram') {
      return;
    }
    setTelegramChatListMinimized(!state.telegramChatListMinimized);
  };

  const closeTelegramEmojiCompletion = (): void => {
    telegramEmojiCompletionState = {
      visible: false,
      query: '',
      tokenStart: 0,
      tokenEnd: 0,
      activeIndex: 0,
      suggestions: [],
    };
    telegramEmojiCompletionEl.replaceChildren();
    telegramEmojiCompletionEl.classList.add('hidden');
    telegramComposeInput.setAttribute('aria-expanded', 'false');
    telegramComposeInput.removeAttribute('aria-activedescendant');
  };

  const renderTelegramEmojiCompletion = (): void => {
    if (
      !telegramEmojiCompletionState.visible ||
      telegramEmojiCompletionState.suggestions.length < 1 ||
      state.activeNetwork !== 'telegram' ||
      document.activeElement !== telegramComposeInput
    ) {
      closeTelegramEmojiCompletion();
      return;
    }

    const activeIndex = Math.max(
      0,
      Math.min(
        telegramEmojiCompletionState.activeIndex,
        telegramEmojiCompletionState.suggestions.length - 1,
      ),
    );
    telegramEmojiCompletionState.activeIndex = activeIndex;

    const items = telegramEmojiCompletionState.suggestions.map((suggestion, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'telegram-emoji-completion-item';
      item.setAttribute('role', 'option');
      item.id = `telegram-emoji-completion-item-${index}`;
      const isActive = index === activeIndex;
      item.setAttribute('aria-selected', String(isActive));
      if (isActive) {
        item.classList.add('active');
      }

      const emoji = document.createElement('span');
      emoji.className = 'telegram-emoji-completion-value';
      emoji.textContent = suggestion.emoji;

      const copy = document.createElement('span');
      copy.className = 'telegram-emoji-completion-copy';
      const alias = document.createElement('span');
      alias.className = 'telegram-emoji-completion-alias';
      alias.textContent = `:${suggestion.canonicalAlias}:`;
      copy.append(alias);

      if (suggestion.matchedAlias !== suggestion.canonicalAlias) {
        const via = document.createElement('span');
        via.className = 'telegram-emoji-completion-match';
        via.textContent = `via :${suggestion.matchedAlias}`;
        copy.append(via);
      }

      item.replaceChildren(emoji, copy);
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        telegramEmojiCompletionState.activeIndex = index;
        insertTelegramEmojiCompletion();
      });
      return item;
    });

    telegramEmojiCompletionEl.replaceChildren(...items);
    telegramEmojiCompletionEl.classList.remove('hidden');
    telegramComposeInput.setAttribute('aria-controls', 'telegram-emoji-completion');
    telegramComposeInput.setAttribute('aria-expanded', 'true');
    telegramComposeInput.setAttribute(
      'aria-activedescendant',
      `telegram-emoji-completion-item-${activeIndex}`,
    );
  };

  const updateTelegramEmojiCompletion = (): void => {
    const tokenMatch = getTelegramEmojiTokenMatch(
      telegramComposeInput.value,
      telegramComposeInput.selectionStart,
      telegramComposeInput.selectionEnd,
    );
    if (!tokenMatch) {
      closeTelegramEmojiCompletion();
      return;
    }

    const suggestions = buildTelegramEmojiSuggestions(tokenMatch.query);
    if (suggestions.length < 1) {
      closeTelegramEmojiCompletion();
      return;
    }

    const previousSuggestion =
      telegramEmojiCompletionState.suggestions[telegramEmojiCompletionState.activeIndex];
    let activeIndex = 0;
    if (previousSuggestion) {
      const matchedIndex = suggestions.findIndex(
        (suggestion) =>
          suggestion.canonicalAlias === previousSuggestion.canonicalAlias &&
          suggestion.matchedAlias === previousSuggestion.matchedAlias,
      );
      if (matchedIndex >= 0) {
        activeIndex = matchedIndex;
      }
    }

    telegramEmojiCompletionState = {
      visible: true,
      query: tokenMatch.query,
      tokenStart: tokenMatch.tokenStart,
      tokenEnd: tokenMatch.tokenEnd,
      activeIndex,
      suggestions,
    };
    renderTelegramEmojiCompletion();
  };

  const moveTelegramEmojiCompletion = (offset: number): void => {
    if (!telegramEmojiCompletionState.visible || telegramEmojiCompletionState.suggestions.length < 1) {
      return;
    }
    const maxIndex = telegramEmojiCompletionState.suggestions.length - 1;
    telegramEmojiCompletionState.activeIndex = Math.max(
      0,
      Math.min(maxIndex, telegramEmojiCompletionState.activeIndex + offset),
    );
    renderTelegramEmojiCompletion();
  };

  const insertTelegramEmojiCompletion = (): boolean => {
    if (!telegramEmojiCompletionState.visible || telegramEmojiCompletionState.suggestions.length < 1) {
      return false;
    }

    const suggestion =
      telegramEmojiCompletionState.suggestions[telegramEmojiCompletionState.activeIndex];
    if (!suggestion) {
      closeTelegramEmojiCompletion();
      return false;
    }

    const before = telegramComposeInput.value.slice(0, telegramEmojiCompletionState.tokenStart);
    const after = telegramComposeInput.value.slice(telegramEmojiCompletionState.tokenEnd);
    const nextValue = `${before}${suggestion.emoji}${after}`;
    const nextSelection = before.length + suggestion.emoji.length;
    telegramComposeInput.value = nextValue;
    telegramComposeInput.focus();
    telegramComposeInput.setSelectionRange(nextSelection, nextSelection);
    syncTelegramComposeInputHeight();
    closeTelegramEmojiCompletion();
    return true;
  };

  const instagramWebShell = instagramEnabled ? document.createElement('section') : null;
  if (instagramWebShell) {
    instagramWebShell.className = 'instagram-web-shell hidden';
    instagramWebShell.innerHTML = `
      <div class="instagram-web-stage">
        <div class="instagram-web-frame">
          <div id="instagram-webview-host" class="instagram-webview-host"></div>
        </div>
      </div>
    `;
    views.append(instagramWebShell);
  }

  const instagramWebviewHost =
    instagramWebShell?.querySelector<HTMLElement>('#instagram-webview-host') ?? null;

  if (instagramEnabled && !instagramWebviewHost) {
    throw new Error('Instagram web shell elements missing');
  }

  const telegramImageModal = document.createElement('div');
  telegramImageModal.className = 'qr-modal hidden';
  telegramImageModal.innerHTML = `
    <div class="telegram-image-modal-card">
      <header class="telegram-image-modal-header">
        <div class="telegram-image-modal-title">Preview</div>
        <div class="telegram-image-modal-actions">
          <button id="telegram-image-copy" class="ghost-button" type="button">Copy</button>
          <button id="telegram-image-download" class="ghost-button" type="button">Download</button>
          <button id="telegram-image-close" class="ghost-button" type="button">Close</button>
        </div>
      </header>
      <div class="telegram-image-modal-body">
        <img id="telegram-image-preview" class="telegram-image-preview" alt="Telegram image preview" />
      </div>
    </div>
  `;
  appEl.append(telegramImageModal);

  const telegramImageCopyEl =
    telegramImageModal.querySelector<HTMLButtonElement>('#telegram-image-copy');
  const telegramImageDownloadEl =
    telegramImageModal.querySelector<HTMLButtonElement>('#telegram-image-download');
  const telegramImageCloseEl =
    telegramImageModal.querySelector<HTMLButtonElement>('#telegram-image-close');

  if (
    !telegramImageCopyEl ||
    !telegramImageDownloadEl ||
    !telegramImageCloseEl
  ) {
    throw new Error('Telegram image modal elements missing');
  }

  const telegramForwardModal = document.createElement('div');
  telegramForwardModal.className = 'qr-modal hidden';
  telegramForwardModal.innerHTML = `
    <div class="telegram-forward-card">
      <header class="telegram-forward-header">
        <button
          id="telegram-forward-close"
          class="telegram-forward-close"
          type="button"
          aria-label="Close forward picker"
        >
          x
        </button>
        <div class="telegram-forward-title">Forward to...</div>
      </header>
      <div class="telegram-forward-search-shell">
        <input
          id="telegram-forward-search"
          class="telegram-forward-search"
          type="text"
          placeholder="Search chats"
        />
      </div>
      <div id="telegram-forward-list" class="telegram-forward-list"></div>
    </div>
  `;
  appEl.append(telegramForwardModal);

  const telegramForwardCloseEl =
    telegramForwardModal.querySelector<HTMLButtonElement>('#telegram-forward-close');
  const telegramForwardSearchEl =
    telegramForwardModal.querySelector<HTMLInputElement>('#telegram-forward-search');

  if (!telegramForwardCloseEl || !telegramForwardSearchEl) {
    throw new Error('Telegram forward modal elements missing');
  }

  let qrStatusPollTimer: number | null = null;
  let qrStatusPollBusy = false;
  let instagramBrowserSessionPollTimer: number | null = null;
  let instagramBrowserSessionPollBusy = false;
  let activeTelegramImageUrl: string | null = null;
  let authPromptResolver: ((value: string | null) => void) | null = null;
  let authPromptState: AuthPromptState | null = null;
  let qrAuthState: QrAuthState | null = null;
  let telegramContextMenuOpenedAt = 0;
  let telegramContextMenuState: TelegramContextMenuState = {
    visible: false,
    messageId: null,
    x: 0,
    y: 0,
  };
  let telegramForwardState: TelegramForwardState = {
    visible: false,
    messageId: null,
    fromChatId: null,
    query: '',
    sending: false,
  };

  const closeTelegramImagePreview = (): void => {
    activeTelegramImageUrl = null;
    render();
  };

  const closeTelegramForwardMenu = (shouldRender = true): void => {
    if (
      !telegramForwardState.visible &&
      !telegramForwardState.messageId &&
      !telegramForwardState.fromChatId &&
      !telegramForwardState.query
    ) {
      return;
    }

    telegramForwardState = {
      visible: false,
      messageId: null,
      fromChatId: null,
      query: '',
      sending: false,
    };

    if (shouldRender) {
      render();
    }
  };

  const buildPendingTelegramSignature = (message: Partial<ChatMessage>): string => {
    const text = safeText(message.text).trim();
    return [
      text,
      message.replyToMessageId ?? '',
      message.imageUrl ? 'image' : '',
      message.animationUrl ? 'animation' : '',
      message.stickerUrl ? 'sticker' : '',
      message.audioUrl || message.hasAudio ? 'audio' : '',
      message.document?.fileName ?? '',
      message.call ? 'call' : '',
    ].join('|');
  };

  const normalizeTelegramComparableEmoji = (value: string): string =>
    value
      .normalize('NFC')
      .replace(/[\uFE0E\uFE0F]/g, '')
      .replace(/\s+/g, '');

  const extractTelegramComparableEmoji = (
    message: Partial<ChatMessage>,
  ): string | undefined => {
    const stickerEmoji = safeText(message.stickerEmoji).trim();
    if (stickerEmoji) {
      return normalizeTelegramComparableEmoji(stickerEmoji);
    }

    const text = safeText(message.text).trim();
    if (!text) {
      return undefined;
    }

    if (!message.imageUrl && !message.document && !message.call && !message.audioUrl && !message.hasAudio) {
      const animatedEmojiMatch = text.match(/^animated emoji\s+(.+)$/i);
      if (animatedEmojiMatch?.[1]) {
        return normalizeTelegramComparableEmoji(animatedEmojiMatch[1]);
      }

      const stickerMatch = text.match(/^sticker\s+(.+)$/i);
      if (stickerMatch?.[1]) {
        return normalizeTelegramComparableEmoji(stickerMatch[1]);
      }
    }

    const normalized = normalizeTelegramComparableEmoji(text);
    const withoutEmoji = normalized.replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200D]/gu, '');
    return normalized && withoutEmoji.length < 1 ? normalized : undefined;
  };

  const isPendingTelegramMessage = (
    message: RenderableTelegramMessage | ChatMessage | undefined,
  ): message is PendingTelegramMessage => Boolean(message && 'pendingState' in message && message.pendingState === 'sending');

  const getTelegramReadableMessageIds = (
    chatId: string | null = state.activeTelegramChatId,
  ): string[] =>
    getVisibleTelegramMessages(chatId)
      .filter((message) => !message.outgoing && !isPendingTelegramMessage(message))
      .map((message) => message.id);

  const isTelegramMessageListNearBottom = (): boolean =>
    telegramMessageListEl.scrollHeight - telegramMessageListEl.scrollTop - telegramMessageListEl.clientHeight < 24;

  const acknowledgeActiveTelegramChatRead = async (): Promise<void> => {
    if (
      state.activeNetwork !== 'telegram' ||
      !areTelegramMessagesVisible() ||
      !document.hasFocus() ||
      state.telegramMessagesLoading ||
      !state.activeTelegramChatId ||
      !isTelegramMessageListNearBottom()
    ) {
      return;
    }

    const messageIds = getTelegramReadableMessageIds(state.activeTelegramChatId);
    const latestMessageId = messageIds[messageIds.length - 1];
    if (!latestMessageId) {
      return;
    }

    const acknowledgeKey = `${state.activeTelegramChatId}:${latestMessageId}`;
    if (acknowledgeKey === lastTelegramReadAcknowledgeKey) {
      return;
    }

    await window.pelec.markConnectorChatRead('telegram', state.activeTelegramChatId, messageIds);
    lastTelegramReadAcknowledgeKey = acknowledgeKey;
    scheduleTelegramChatsRefresh(120, false);
  };

  const scheduleTelegramReadAcknowledgement = (): void => {
    if (telegramReadAcknowledgeTimer !== null) {
      window.clearTimeout(telegramReadAcknowledgeTimer);
    }
    telegramReadAcknowledgeTimer = window.setTimeout(() => {
      telegramReadAcknowledgeTimer = null;
      void acknowledgeActiveTelegramChatRead();
    }, 80);
  };

  const bumpTelegramMessagesVersion = (): void => {
    telegramMessagesVersion += 1;
  };

  const getPendingTelegramMessages = (chatId: string | null): PendingTelegramMessage[] => {
    if (!chatId) {
      return [];
    }
    return pendingTelegramMessagesByChat.get(chatId) ?? [];
  };

  const getVisibleTelegramMessages = (
    chatId: string | null = state.activeTelegramChatId,
  ): RenderableTelegramMessage[] => {
    const pending = getPendingTelegramMessages(chatId);
    if (pending.length < 1) {
      return state.telegramMessages;
    }
    return [...state.telegramMessages, ...pending];
  };

  const mergeTelegramMessages = (
    current: ChatMessage[],
    incoming: ChatMessage[],
    mode: 'prepend-history' | 'refresh-latest',
  ): ChatMessage[] => {
    if (current.length < 1) {
      return incoming;
    }
    if (incoming.length < 1) {
      return current;
    }

    const nextById = new Map<string, ChatMessage>();
    for (const message of current) {
      nextById.set(message.id, message);
    }
    for (const message of incoming) {
      nextById.set(message.id, message);
    }

    const incomingIds = new Set(incoming.map((message) => message.id));
    const currentOldestIncoming = incoming[0];
    const merged = [...nextById.values()].filter((message) => {
      if (mode !== 'refresh-latest' || !currentOldestIncoming) {
        return true;
      }
      if (incomingIds.has(message.id)) {
        return true;
      }
      if (message.timestamp !== currentOldestIncoming.timestamp) {
        return message.timestamp < currentOldestIncoming.timestamp;
      }
      return compareNotificationMessageIds(message.id, currentOldestIncoming.id) < 0;
    });

    return merged.sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return compareNotificationMessageIds(a.id, b.id);
    });
  };

  const addPendingTelegramMessages = (...messages: PendingTelegramMessage[]): void => {
    if (messages.length < 1) {
      return;
    }
    const chatId = messages[0].chatId;
    const current = pendingTelegramMessagesByChat.get(chatId) ?? [];
    pendingTelegramMessagesByChat.set(chatId, [...current, ...messages]);
    bumpTelegramMessagesVersion();
  };

  const removePendingTelegramMessages = (
    chatId: string,
    predicate: (message: PendingTelegramMessage) => boolean,
  ): boolean => {
    const current = pendingTelegramMessagesByChat.get(chatId) ?? [];
    if (current.length < 1) {
      return false;
    }
    const next = current.filter((message) => !predicate(message));
    if (next.length === current.length) {
      return false;
    }
    if (next.length < 1) {
      pendingTelegramMessagesByChat.delete(chatId);
    } else {
      pendingTelegramMessagesByChat.set(chatId, next);
    }
    bumpTelegramMessagesVersion();
    return true;
  };

  const createPendingTelegramMessage = (
    chatId: string,
    message: Partial<ChatMessage>,
  ): PendingTelegramMessage => {
    const timestamp = hasValidTimestamp(message.timestamp) ? message.timestamp : Date.now();
    return {
      id: `pending:${chatId}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
      sender: safeLabel(message.sender, 'You'),
      text: safeText(message.text),
      timestamp,
      outgoing: true,
      readByPeer: false,
      replyToMessageId: message.replyToMessageId,
      replyToSender: message.replyToSender,
      replyToText: message.replyToText,
      imageUrl: message.imageUrl,
      hasVideo: message.hasVideo,
      videoUrl: message.videoUrl,
      videoMimeType: message.videoMimeType,
      animationUrl: message.animationUrl,
      animationMimeType: message.animationMimeType,
      stickerUrl: message.stickerUrl,
      stickerEmoji: message.stickerEmoji,
      stickerIsAnimated: message.stickerIsAnimated,
      hasAudio: message.hasAudio,
      audioUrl: message.audioUrl,
      audioDurationSeconds: message.audioDurationSeconds,
      document: message.document,
      call: message.call,
      pendingState: 'sending',
      chatId,
      signature: buildPendingTelegramSignature(message),
    };
  };

  const matchesPendingTelegramMessage = (
    pendingMessage: PendingTelegramMessage,
    message: ChatMessage,
  ): boolean => {
    if (!message.outgoing) {
      return false;
    }
    if (buildPendingTelegramSignature(message) !== pendingMessage.signature) {
      const pendingEmoji = extractTelegramComparableEmoji(pendingMessage);
      const messageEmoji = extractTelegramComparableEmoji(message);
      if (
        !pendingEmoji ||
        !messageEmoji ||
        pendingEmoji !== messageEmoji ||
        (pendingMessage.replyToMessageId ?? '') !== (message.replyToMessageId ?? '')
      ) {
        return false;
      }
    }
    const delta = message.timestamp - pendingMessage.timestamp;
    return delta >= -60000 && delta <= 5 * 60 * 1000;
  };

  const reconcilePendingTelegramMessages = (chatId: string, messages: ChatMessage[]): boolean => {
    const pending = pendingTelegramMessagesByChat.get(chatId) ?? [];
    if (pending.length < 1) {
      return false;
    }

    const matchedIndexes = new Set<number>();
    const remaining = pending.filter((pendingMessage) => {
      const matchIndex = messages.findIndex(
        (message, index) =>
          !matchedIndexes.has(index) && matchesPendingTelegramMessage(pendingMessage, message),
      );
      if (matchIndex === -1) {
        return true;
      }
      matchedIndexes.add(matchIndex);
      return false;
    });

    if (remaining.length === pending.length) {
      return false;
    }

    if (remaining.length < 1) {
      pendingTelegramMessagesByChat.delete(chatId);
    } else {
      pendingTelegramMessagesByChat.set(chatId, remaining);
    }
    bumpTelegramMessagesVersion();
    return true;
  };

  const findTelegramMessageById = (
    messageId: string | null,
  ): RenderableTelegramMessage | undefined => {
    if (!messageId) {
      return undefined;
    }
    return getVisibleTelegramMessages().find((message) => message.id === messageId);
  };

  const closeTelegramContextMenu = (shouldRender = true): void => {
    if (!telegramContextMenuState.visible && !telegramContextMenuState.messageId) {
      return;
    }
    telegramContextMenuState = {
      visible: false,
      messageId: null,
      x: 0,
      y: 0,
    };
    if (shouldRender) {
      render();
    }
  };

  const isTelegramContextMenuGuardActive = (): boolean =>
    telegramContextMenuState.visible &&
    performance.now() - telegramContextMenuOpenedAt < TELEGRAM_CONTEXT_MENU_GUARD_MS;

  const isSecondaryTelegramPointerEvent = (event: MouseEvent | PointerEvent): boolean =>
    event.button === 2 || (event.button === 0 && event.ctrlKey);

  const selectTelegramMessage = (messageId: string): void => {
    state.vimPane = 'telegram-messages';
    state.selectedTelegramMessageId = messageId;
  };

  const activateTelegramMessagesPane = (): void => {
    state.vimPane = 'telegram-messages';
    if (!state.selectedTelegramMessageId) {
      const telegramMessages = getVisibleTelegramMessages();
      state.selectedTelegramMessageId =
        telegramMessages[telegramMessages.length - 1]?.id ?? null;
    }
  };

  const openTelegramContextMenu = (messageId: string, x: number, y: number): void => {
    const message = findTelegramMessageById(messageId);
    if (isPendingTelegramMessage(message)) {
      return;
    }
    selectTelegramMessage(messageId);
    telegramContextMenuOpenedAt = performance.now();
    telegramContextMenuState = {
      visible: true,
      messageId,
      x,
      y,
    };
    render();
  };

  const openTelegramForwardMenu = (messageId: string): void => {
    if (!state.activeTelegramChatId) {
      statusBar.textContent = 'Open a Telegram chat before forwarding.';
      return;
    }

    selectTelegramMessage(messageId);
    telegramForwardState = {
      visible: true,
      messageId,
      fromChatId: state.activeTelegramChatId,
      query: '',
      sending: false,
    };
    render();
  };

  const setTelegramForwardQuery = (query: string): void => {
    telegramForwardState = {
      ...telegramForwardState,
      query,
    };
    render();
  };

  const buildTelegramMessageActionText = (message: ChatMessage): string => {
    const text = safeText(message.text).trim();
    if (text) {
      return text;
    }
    if (message.call) {
      return describeTelegramCall(message.call, message.outgoing).preview;
    }
    if (message.document) {
      return safeLabel(message.document.fileName, 'Document');
    }
    if (message.imageUrl) {
      return 'Photo';
    }
    if (message.animationUrl) {
      return 'Animation';
    }
    if (message.stickerUrl) {
      return message.stickerEmoji ? `Sticker ${message.stickerEmoji}` : 'Sticker';
    }
    if (message.hasAudio || message.audioUrl) {
      return 'Voice message';
    }
    return '[message]';
  };

  const writeTextToClipboard = async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
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
    }
  };

  const copyTelegramMessageText = async (message: ChatMessage): Promise<void> => {
    const copied = await writeTextToClipboard(buildTelegramMessageActionText(message));
    statusBar.textContent = copied ? 'Message copied.' : 'Copy failed.';
  };

  const copyTelegramMessageById = (messageId: string): void => {
    const message = findTelegramMessageById(messageId);
    if (!message || isPendingTelegramMessage(message)) {
      statusBar.textContent = 'Message unavailable.';
      render();
      return;
    }
    void copyTelegramMessageText(message);
  };

  const clearTelegramReplyState = (options: { clearAttachments?: boolean } = {}): void => {
    state.replyingToMessageId = null;
    state.replyingToSender = null;
    if (options.clearAttachments) {
      state.pendingTelegramAttachments = [];
    }
  };

  const getTelegramReplyPreview = (): { sender: string; text: string } | null => {
    if (!state.replyingToMessageId) {
      return null;
    }

    const replyTarget = findTelegramMessageById(state.replyingToMessageId);
    if (replyTarget && !isPendingTelegramMessage(replyTarget)) {
      return {
        sender: safeLabel(replyTarget.sender, state.replyingToSender ?? 'Reply'),
        text: buildTelegramMessageActionText(replyTarget),
      };
    }

    return {
      sender: safeLabel(state.replyingToSender, 'Reply'),
      text: 'Original message unavailable.',
    };
  };

  const beginReplyToTelegramMessage = (message: ChatMessage): void => {
    if (isPendingTelegramMessage(message)) {
      statusBar.textContent = 'Wait for the message to finish sending.';
      return;
    }
    if (!activeTelegramChatCanSend()) {
      statusBar.textContent = 'You cannot post in this channel.';
      render();
      return;
    }
    state.replyingToMessageId = message.id;
    state.replyingToSender = message.sender;
    setMode('insert');
    statusBar.textContent = `Replying to ${message.sender}`;
  };

  const forwardTelegramMessageToChat = async (chat: ChatSummary): Promise<void> => {
    const messageId = telegramForwardState.messageId;
    const fromChatId = telegramForwardState.fromChatId;
    const message = findTelegramMessageById(messageId);

    if (!messageId || !fromChatId || !message) {
      closeTelegramForwardMenu();
      return;
    }

    telegramForwardState = {
      ...telegramForwardState,
      sending: true,
    };
    statusBar.textContent = `Forwarding to ${safeLabel(chat.title, 'chat')}...`;
    render();

    const forwarded = await window.pelec.forwardConnectorMessage(
      'telegram',
      fromChatId,
      chat.id,
      messageId,
    );

    if (!forwarded) {
      await refreshConnectorStatuses();
      const status = getStatusByNetwork('telegram');
      telegramForwardState = {
        ...telegramForwardState,
        sending: false,
      };
      statusBar.textContent = `Forward failed: ${status.lastError ?? status.details}`;
      render();
      return;
    }

    closeTelegramForwardMenu(false);
    await loadTelegramChats();
    await selectTelegramChat(chat.id, {
      forceScroll: true,
      suppressNotification: true,
      showLoadingState: true,
    });
    statusBar.textContent = `Forwarded to ${safeLabel(chat.title, 'chat')}.`;
    render();
  };

  const forwardTelegramMessageToChatById = (chatId: string): void => {
    const chat = state.telegramChats.find((candidate) => candidate.id === chatId);
    if (!chat) {
      statusBar.textContent = 'Telegram chat unavailable.';
      render();
      return;
    }
    void forwardTelegramMessageToChat(chat);
  };

  const getTelegramForwardCandidates = (): ChatSummary[] => {
    const message = findTelegramMessageById(telegramForwardState.messageId);
    if (
      !telegramForwardState.visible ||
      state.activeNetwork !== 'telegram' ||
      getStatusByNetwork('telegram').authState !== 'authenticated' ||
      !telegramForwardState.fromChatId ||
      !message ||
      isPendingTelegramMessage(message)
    ) {
      if (telegramForwardState.visible || telegramForwardState.messageId || telegramForwardState.fromChatId) {
        telegramForwardState = {
          visible: false,
        messageId: null,
        fromChatId: null,
        query: '',
        sending: false,
      };
    }
      return [];
    }

    return filterChatsByQuery(state.telegramChats, telegramForwardState.query).filter(
      (chat) => chat.id !== telegramForwardState.fromChatId,
    );
  };

  const downloadTelegramImage = (url: string): void => {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'telegram-image';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  };

  const copyTelegramImage = async (url: string): Promise<void> => {
    try {
      const dataUrl = url.trim();
      if (!dataUrl.startsWith('data:image/')) {
        throw new Error('Unsupported image URL.');
      }
      const copied = await window.pelec.copyImageToClipboard(dataUrl);
      if (copied) {
        statusBar.textContent = 'Image copied.';
        return;
      }
    } catch {
      // Fall through to failure state below.
    }

    statusBar.textContent = 'Failed to copy image.';
  };

  const downloadTelegramDocument = async (
    chatId: string,
    message: ChatMessage,
    button: HTMLButtonElement,
  ): Promise<void> => {
    if (!message.document) {
      return;
    }

    button.disabled = true;
    try {
      setStatusActivity({
        id: `pending-download:${message.id}`,
        label: `Preparing ${message.document.fileName}`,
        detail: 'Fetching the document from Telegram…',
        indeterminate: true,
        state: 'running',
      });
      render();
      await window.pelec.downloadConnectorDocument('telegram', chatId, message.id);
    } catch (error) {
      setStatusActivity({
        id: `download-error:${message.id}`,
        label: 'Download failed',
        detail: error instanceof Error ? error.message : `Could not download ${message.document.fileName}.`,
        state: 'error',
      });
      render();
    } finally {
      button.disabled = false;
    }
  };

  const copyTelegramDocument = async (
    chatId: string,
    message: ChatMessage,
    button: HTMLButtonElement,
  ): Promise<void> => {
    if (!message.document) {
      return;
    }

    button.disabled = true;
    try {
      setStatusActivity({
        id: `pending-copy:${message.id}`,
        label: `Preparing ${message.document.fileName}`,
        detail: 'Resolving the document for clipboard copy…',
        indeterminate: true,
        state: 'running',
      });
      render();
      await window.pelec.copyConnectorDocument('telegram', chatId, message.id);
    } catch (error) {
      setStatusActivity({
        id: `copy-error:${message.id}`,
        label: 'Copy failed',
        detail: error instanceof Error ? error.message : `Could not copy ${message.document.fileName}.`,
        state: 'error',
      });
      render();
    } finally {
      button.disabled = false;
    }
  };

  const resolveTelegramAudioUrl = async (
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> => {
    return telegramAudioUrlCache.get(`${chatId}:${messageId}`, () =>
      window.pelec.resolveConnectorAudioUrl('telegram', chatId, messageId),
    );
  };

  const resolveTelegramVideoUrl = async (
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> => {
    return telegramVideoUrlCache.get(`${chatId}:${messageId}`, () =>
      window.pelec.resolveConnectorVideoUrl('telegram', chatId, messageId),
    );
  };

  const openTelegramImagePreview = (url: string): void => {
    activeTelegramImageUrl = url;
    render();
  };

  const copyActiveTelegramImagePreview = (): void => {
    if (!activeTelegramImageUrl) {
      return;
    }
    void copyTelegramImage(activeTelegramImageUrl);
  };

  const downloadActiveTelegramImagePreview = (): void => {
    if (!activeTelegramImageUrl) {
      return;
    }
    downloadTelegramImage(activeTelegramImageUrl);
  };

  telegramImageCopyEl.addEventListener('click', () => {
    copyActiveTelegramImagePreview();
  });

  telegramImageDownloadEl.addEventListener('click', () => {
    downloadActiveTelegramImagePreview();
  });

  telegramImageCloseEl.addEventListener('click', () => {
    closeTelegramImagePreview();
  });

  telegramImageModal.addEventListener('click', (event) => {
    if (event.target === telegramImageModal) {
      closeTelegramImagePreview();
    }
  });

  telegramForwardCloseEl.addEventListener('click', () => {
    closeTelegramForwardMenu();
  });

  telegramForwardSearchEl.addEventListener('input', () => {
    setTelegramForwardQuery(telegramForwardSearchEl.value);
  });

  telegramForwardModal.addEventListener('click', (event) => {
    if (event.target === telegramForwardModal && !telegramForwardState.sending) {
      closeTelegramForwardMenu();
    }
  });

  telegramMessageListEl.addEventListener('scroll', () => {
    if (isTelegramContextMenuGuardActive()) {
      return;
    }
    closeTelegramContextMenu();
    scheduleTelegramReadAcknowledgement();
  });

  telegramChatListEl.addEventListener('scroll', () => {
    if (isTelegramContextMenuGuardActive()) {
      return;
    }
    closeTelegramContextMenu();
  });

  window.addEventListener('resize', () => {
    closeTelegramContextMenu();
  });

  window.addEventListener('focus', () => {
    windowHasFocus = true;
    ensureBackgroundRefreshLoops();
    scheduleTelegramReadAcknowledgement();
  });

  window.addEventListener('blur', () => {
    windowHasFocus = false;
    ensureBackgroundRefreshLoops();
  });

  document.addEventListener('visibilitychange', () => {
    documentVisible = document.visibilityState === 'visible';
    ensureBackgroundRefreshLoops();
  });

  const requestAuthInput = async ({
    title,
    message,
    placeholder,
    label,
    stepLabel,
    secret = false,
    trim = true,
    submitLabel = 'Submit',
    onCancel,
  }: {
    title: string;
    message: string;
    placeholder: string;
    label: string;
    stepLabel?: string;
    secret?: boolean;
    trim?: boolean;
    submitLabel?: string;
    onCancel?: () => void | Promise<void>;
  }): Promise<string | null> =>
    new Promise((resolve) => {
      authPromptResolver = resolve;
      authPromptState = {
        label,
        message,
        onCancel,
        placeholder,
        secret,
        stepLabel: stepLabel ?? null,
        submitLabel,
        title,
        trim,
      };
      render();
    });

  const finalizeAuthPrompt = (value: string | null): void => {
    const resolve = authPromptResolver;
    authPromptResolver = null;
    authPromptState = null;
    render();
    resolve?.(value);
  };

  const submitAuthPrompt = (value: string): void => {
    const prompt = authPromptState;
    if (!prompt) {
      return;
    }
    const nextValue = prompt.trim ? value.trim() : value;
    finalizeAuthPrompt(nextValue || null);
  };

  const cancelAuthPrompt = (): void => {
    const prompt = authPromptState;
    if (!prompt) {
      return;
    }
    const onCancel = prompt.onCancel;
    authPromptState = null;
    render();
    void Promise.resolve(onCancel?.()).finally(() => {
      finalizeAuthPrompt(null);
    });
  };

  const refreshQrAuth = (): void => {
    if (!qrAuthState) {
      return;
    }
    statusBar.textContent = 'Requesting a fresh Telegram QR...';
    void startAuthForNetwork(qrAuthState.network);
  };

  const revealQrPassword = (): void => {
    if (!qrAuthState) {
      return;
    }
    qrAuthState = {
      ...qrAuthState,
      passwordRequired: true,
    };
    render();
  };

  const submitQrPassword = (value: string): void => {
    if (!qrAuthState) {
      return;
    }
    const password = value.trim();
    if (!password) {
      return;
    }

    void (async () => {
      await window.pelec.submitConnectorAuth(qrAuthState.network, {
        type: 'password',
        value: password,
      });
      await refreshConnectorStatuses();
      const status = getStatusByNetwork(qrAuthState.network);
      if (status.authState === 'authenticated') {
        hideQrModal();
        await loadTelegramChats();
      } else {
        statusBar.textContent = status.details;
        render();
      }
    })();
  };

  const stopQrStatusPolling = (): void => {
    if (qrStatusPollTimer !== null) {
      window.clearInterval(qrStatusPollTimer);
      qrStatusPollTimer = null;
    }
    qrStatusPollBusy = false;
  };

  const stopInstagramBrowserSessionPolling = (): void => {
    if (instagramBrowserSessionPollTimer !== null) {
      window.clearInterval(instagramBrowserSessionPollTimer);
      instagramBrowserSessionPollTimer = null;
    }
    instagramBrowserSessionPollBusy = false;
  };

  const startInstagramBrowserSessionPolling = (): void => {
    stopInstagramBrowserSessionPolling();
    instagramBrowserSessionPollTimer = window.setInterval(() => {
      if (instagramBrowserSessionPollBusy) {
        return;
      }
      instagramBrowserSessionPollBusy = true;
      void (async () => {
        try {
          const submittedStatus = await window.pelec.submitConnectorAuth('instagram', {
            type: 'code',
            value: 'session-check',
          });
          await refreshConnectorStatuses();
          if (submittedStatus.authState === 'authenticated') {
            stopInstagramBrowserSessionPolling();
            setMode('normal');
          }
          render();
        } catch {
          // Keep polling while the user completes login/challenge in the webview.
        } finally {
          instagramBrowserSessionPollBusy = false;
        }
      })();
    }, 2000);
  };

  const hideQrModal = (): void => {
    qrAuthState = null;
    stopQrStatusPolling();
    render();
  };

  const startQrStatusPolling = (network: NetworkId): void => {
    stopQrStatusPolling();
    qrStatusPollTimer = window.setInterval(() => {
      if (qrStatusPollBusy) {
        return;
      }
      qrStatusPollBusy = true;
      void (async () => {
        try {
          await refreshConnectorStatuses();
          const status = getStatusByNetwork(network);
          if (status.authState === 'authenticated') {
            hideQrModal();
            await loadTelegramChats();
            statusBar.textContent = `${getNetworkById(network).name} authenticated.`;
            render();
          } else if (status.authState === 'degraded' && status.lastError) {
            statusBar.textContent = status.details;
            render();
          }
        } finally {
          qrStatusPollBusy = false;
        }
      })();
    }, 1200);
  };

  const getNetworkById = (id: NetworkId): NetworkDefinition => {
    const network = appConfig.networks.find((value) => value.id === id);
    if (!network) {
      throw new Error(`Unknown network: ${id}`);
    }
    return network;
  };

  const getStatusByNetwork = (id: NetworkId): ConnectorStatus => {
    const status = state.connectorStatuses[id];
    if (!status) {
      const network = appConfig.networks.find((value) => value.id === id);
      return {
        network: id,
        mode: 'web-fallback',
        authState: 'unauthenticated',
        capabilities: { qr: false, twoFactor: false, officialApi: false },
        partition: network?.partition ?? `persist:${id}`,
        webUrl: network?.homeUrl ?? 'about:blank',
        details: 'No connector status available. Using web fallback.',
      };
    }
    return status;
  };

  const setStatusActivity = (activity: AppActivity | null): void => {
    statusActivity = activity;
    bridge?.onActivityChange?.(activity);

    if (statusActivityClearTimer !== null) {
      window.clearTimeout(statusActivityClearTimer);
      statusActivityClearTimer = null;
    }

    if (activity && activity.state !== 'running') {
      statusActivityClearTimer = window.setTimeout(() => {
        statusActivityClearTimer = null;
        if (statusActivity?.id === activity.id) {
          statusActivity = null;
          render();
        }
      }, 4200);
    }
  };

  const renderCurrentStatusBar = (): void => {
    renderStatusToast(statusToastHost, statusActivity);
  };

  const buildStatusText = (id: NetworkId): string => {
    const status = getStatusByNetwork(id);
    const caps = [
      status.capabilities.qr ? 'QR' : null,
      status.capabilities.twoFactor ? '2FA' : null,
      status.capabilities.officialApi ? 'API' : null,
    ]
      .filter(Boolean)
      .join('/');
    return `${status.mode} | ${status.authState}${caps ? ` | ${caps}` : ''}`;
  };

  const isInstagramNativeReady = (): boolean => {
    if (!instagramEnabled) {
      return false;
    }
    const status = getStatusByNetwork('instagram');
    return status.mode === 'native' && status.authState === 'authenticated';
  };

  const getVimPanesForActiveNetwork = (): Array<AppState['vimPane']> => {
    if (state.activeNetwork === 'telegram') {
      return NETWORK_RAIL_VISIBLE
        ? ['networks', 'telegram-chats', 'telegram-messages']
        : ['telegram-chats', 'telegram-messages'];
    }
    if (instagramEnabled && state.activeNetwork === 'instagram' && isInstagramNativeReady()) {
      return NETWORK_RAIL_VISIBLE
        ? ['networks', 'instagram-chats', 'instagram-messages']
        : ['instagram-chats', 'instagram-messages'];
    }
    return ['networks'];
  };

  const areChatListsEqual = (a: ChatSummary[], b: ChatSummary[]): boolean => {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (
        a[i].id !== b[i].id ||
        a[i].title !== b[i].title ||
        a[i].lastMessagePreview !== b[i].lastMessagePreview ||
        a[i].lastMessageTimestamp !== b[i].lastMessageTimestamp ||
        a[i].unreadCount !== b[i].unreadCount ||
        a[i].avatarUrl !== b[i].avatarUrl ||
        a[i].isMuted !== b[i].isMuted ||
        a[i].canSend !== b[i].canSend
      ) {
        return false;
      }
    }
    return true;
  };

  const areMessageListsEqual = (a: ChatMessage[], b: ChatMessage[]): boolean => {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      const aReactions = a[i].reactions ?? [];
      const bReactions = b[i].reactions ?? [];
      const reactionsEqual =
        aReactions.length === bReactions.length &&
        aReactions.every((reaction, index) => {
          const other = bReactions[index];
          return (
            other &&
            reaction.value === other.value &&
            reaction.count === other.count &&
            reaction.chosen === other.chosen
          );
        });
      if (
        a[i].id !== b[i].id ||
        a[i].mediaAlbumId !== b[i].mediaAlbumId ||
        a[i].sender !== b[i].sender ||
        a[i].text !== b[i].text ||
        a[i].timestamp !== b[i].timestamp ||
        a[i].outgoing !== b[i].outgoing ||
        a[i].readByPeer !== b[i].readByPeer ||
        a[i].forwardedFrom !== b[i].forwardedFrom ||
        a[i].replyToMessageId !== b[i].replyToMessageId ||
        a[i].replyToSender !== b[i].replyToSender ||
        a[i].replyToText !== b[i].replyToText ||
        a[i].imageUrl !== b[i].imageUrl ||
        a[i].animationUrl !== b[i].animationUrl ||
        a[i].animationMimeType !== b[i].animationMimeType ||
        a[i].stickerUrl !== b[i].stickerUrl ||
        a[i].stickerEmoji !== b[i].stickerEmoji ||
        a[i].stickerIsAnimated !== b[i].stickerIsAnimated ||
        !reactionsEqual ||
        a[i].hasAudio !== b[i].hasAudio ||
        a[i].audioDurationSeconds !== b[i].audioDurationSeconds ||
        a[i].audioUrl !== b[i].audioUrl ||
        a[i].hasVideo !== b[i].hasVideo ||
        a[i].videoUrl !== b[i].videoUrl ||
        a[i].videoMimeType !== b[i].videoMimeType ||
        a[i].senderAvatarUrl !== b[i].senderAvatarUrl ||
        a[i].document?.fileName !== b[i].document?.fileName ||
        a[i].document?.mimeType !== b[i].document?.mimeType ||
        a[i].document?.sizeBytes !== b[i].document?.sizeBytes ||
        a[i].call?.isVideo !== b[i].call?.isVideo ||
        a[i].call?.durationSeconds !== b[i].call?.durationSeconds ||
        a[i].call?.discardReason !== b[i].call?.discardReason
      ) {
        return false;
      }
    }
    return true;
  };

  const filterChatsByQuery = (chats: ChatSummary[], query: string): ChatSummary[] => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return chats;
    }
    return chats.filter((chat) => {
      const haystack = `${safeText(chat.title)} ${safeText(chat.lastMessagePreview)}`.toLowerCase();
      return haystack.includes(normalized);
    });
  };

  const INSTAGRAM_WEBVIEW_THEME_CSS = `
    html,
    body,
    input,
    textarea,
    button,
    [role="button"],
    [role="link"],
    [contenteditable="true"],
    div,
    span,
    p,
    a,
    li,
    section,
    article,
    header,
    nav,
    aside,
    main {
      font-family: "Ioskeley Mono", "Iosevka Mono", "Iosevka", monospace !important;
    }

    *,
    *::before,
    *::after {
      border-radius: 0 !important;
    }
  `;

  const injectInstagramWebTheme = async (view: Electron.WebviewTag): Promise<void> => {
    try {
      view.setZoomFactor(1.1);
      await view.executeJavaScript(
        `
          (() => {
            const STYLE_ID = 'pelec-instagram-theme';
            const css = ${JSON.stringify(INSTAGRAM_WEBVIEW_THEME_CSS)};

            const getScope = () => {
              const path = window.location.pathname.toLowerCase();
              if (path.startsWith('/direct')) {
                return 'dm';
              }
              if (
                path.startsWith('/accounts/login') ||
                path.includes('/challenge') ||
                path.includes('/checkpoint') ||
                path.includes('/two_factor') ||
                path.includes('/login')
              ) {
                return 'auth';
              }
              return 'neutral';
            };

            const install = () => {
              let style = document.getElementById(STYLE_ID);
              if (!style) {
                style = document.createElement('style');
                style.id = STYLE_ID;
                document.head.appendChild(style);
              }
              if (style.textContent !== css) {
                style.textContent = css;
              }

              const scope = getScope();
              document.documentElement.style.removeProperty('background');
              document.body && document.body.style.removeProperty('background');
              document.documentElement.setAttribute('data-pelec-instagram-theme', '1');
              document.documentElement.setAttribute('data-pelec-instagram-scope', scope);

              if (scope !== 'dm') {
                return;
              }

              const candidates = Array.from(document.querySelectorAll('nav, section, div')).filter((element) => {
                if (!(element instanceof HTMLElement)) {
                  return false;
                }
                const rect = element.getBoundingClientRect();
                if (rect.left > 24 || rect.top > 120) {
                  return false;
                }
                if (rect.width < 44 || rect.width > 110 || rect.height < window.innerHeight * 0.45) {
                  return false;
                }
                const svgCount = element.querySelectorAll('svg').length;
                return svgCount >= 6;
              });

              const leftRail = candidates.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
              if (leftRail instanceof HTMLElement) {
                const lockedWidth = Math.min(84, Math.max(72, Math.round(leftRail.getBoundingClientRect().width || 76)));
                leftRail.style.width = lockedWidth + 'px';
                leftRail.style.minWidth = lockedWidth + 'px';
                leftRail.style.maxWidth = lockedWidth + 'px';
                leftRail.style.flex = '0 0 ' + lockedWidth + 'px';
                leftRail.style.overflow = 'hidden';
                leftRail.style.contain = 'layout paint';

                const labelNodes = Array.from(leftRail.querySelectorAll('span, div')).filter((node) => {
                  if (!(node instanceof HTMLElement)) {
                    return false;
                  }
                  const text = (node.textContent || '').trim();
                  if (!text) {
                    return false;
                  }
                  if (node.querySelector('svg')) {
                    return false;
                  }
                  const rect = node.getBoundingClientRect();
                  return rect.width > 24;
                });

                for (const label of labelNodes) {
                  label.style.opacity = '0';
                  label.style.width = '0';
                  label.style.maxWidth = '0';
                  label.style.overflow = 'hidden';
                  label.style.margin = '0';
                  label.style.padding = '0';
                }

                const iconButtons = Array.from(leftRail.querySelectorAll('a, button, div[role="button"]'));
                for (const button of iconButtons) {
                  if (!(button instanceof HTMLElement)) {
                    continue;
                  }
                  button.style.justifyContent = 'center';
                  button.style.paddingLeft = '0';
                  button.style.paddingRight = '0';
                }
              }
            };

            install();

            if (!window.__pelecInstagramThemeObserver) {
              const observer = new MutationObserver(() => install());
              observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
              });
              window.__pelecInstagramThemeObserver = observer;
            }
          })();
        `,
        true,
      );
    } catch (error) {
      console.warn('Failed to inject Instagram webview theme.', error);
    }
  };

  for (const network of appConfig.networks) {
    const connectorStatus = getStatusByNetwork(network.id);
    const view = document.createElement('webview');
    view.className = 'network-view';
    view.id = `view-${network.id}`;
    view.setAttribute('partition', connectorStatus.partition);
    view.setAttribute('src', connectorStatus.webUrl || network.homeUrl);
    view.setAttribute('allowpopups', 'false');
    view.tabIndex = -1;

    view.addEventListener('focus', () => {
      const isAllowedFocus = state.mode === 'insert' && state.activeNetwork === network.id;
      if (isAllowedFocus) {
        return;
      }

      view.blur?.();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          focusAppKeyboardSurface();
        });
      } else {
        window.setTimeout(() => {
          focusAppKeyboardSurface();
        }, 0);
      }
    });

    view.addEventListener('did-start-loading', () => {
      state.loading[network.id] = true;
      render();
    });

    if (network.id === 'instagram' && instagramEnabled) {
      view.addEventListener('dom-ready', () => {
        void injectInstagramWebTheme(view);
        void pollInstagramWebFallbackNotifications();
      });
    }

    view.addEventListener('did-stop-loading', () => {
      state.loading[network.id] = false;
      if (network.id === 'instagram' && instagramEnabled) {
        void injectInstagramWebTheme(view);
        void pollInstagramWebFallbackNotifications();
      }
      render();

      if (network.id === 'instagram' && instagramEnabled && isInstagramCheckpointCooldownActive()) {
        const remaining = formatCooldownRemaining(instagramCheckpointCooldownUntil);
        statusBar.textContent = `Instagram checkpoint cooldown active (${remaining} remaining).`;
        render();
      }
    });

    view.addEventListener('did-fail-load', () => {
      state.loading[network.id] = false;
      statusBar.textContent = `Failed loading ${network.name}. Check your network.`;
      render();
    });

    if (network.id === 'instagram' && instagramWebviewHost) {
      view.classList.add('instagram-webview');
      instagramWebviewHost.append(view);
    } else {
      views.append(view);
    }
    webviewMap.set(network.id, view);
  }

  const loadTelegramMessages = async (
    chatId: string,
    attempt = 0,
    forceScroll = false,
    suppressNotification = false,
    showLoadingState = false,
  ): Promise<void> => {
    return telegramController.refreshMessages(chatId, async () => {
      const endMeasure = beginMeasure('telegram.messages.load');
      const requestSeq = telegramController.beginMessagesRequest();
      const previousActiveTelegramChatId = state.activeTelegramChatId;
      const hasVisibleMessages = getVisibleTelegramMessages(chatId).length > 0;
      const shouldShowLoadingIndicator = showLoadingState || !hasVisibleMessages;
      state.activeTelegramChatId = chatId;
      if (state.mode === 'insert' && !activeTelegramChatCanSend()) {
        state.mode = 'normal';
      }
      state.telegramMessagesLoading = shouldShowLoadingIndicator;
      state.telegramLoadError = null;
      if (showLoadingState) {
        state.telegramMessages = [];
        telegramHasOlderMessages = false;
        telegramLoadingOlderMessages = false;
        telegramMessagesVersion += 1;
        state.selectedTelegramMessageId = null;
        render();
      }

      try {
        const messages = await window.pelec.listConnectorMessages('telegram', chatId, {
          limit: TELEGRAM_MESSAGES_PAGE_SIZE,
          passive: true,
        });
        if (!telegramController.isCurrentMessagesRequest(requestSeq) || chatId !== state.activeTelegramChatId) {
          return;
        }
        const shouldPreserveLoadedHistory =
          previousActiveTelegramChatId === chatId && !showLoadingState && state.telegramMessages.length > 0;
        const nextMessages = shouldPreserveLoadedHistory
          ? mergeTelegramMessages(state.telegramMessages, messages, 'refresh-latest')
          : messages;
        const changed = !areMessageListsEqual(state.telegramMessages, nextMessages);
        const pendingChanged = reconcilePendingTelegramMessages(chatId, messages);
        const chatTitle = safeLabel(
          state.telegramChats.find((chat) => chat.id === chatId)?.title,
          'Telegram',
        );
        maybeNotifyNewMessages('telegram', chatId, chatTitle, messages, suppressNotification);
        if (changed) {
          state.telegramMessages = nextMessages;
          telegramMessagesVersion += 1;
        }
        if (!shouldPreserveLoadedHistory) {
          telegramHasOlderMessages = messages.length > 0;
        }
        telegramLoadingOlderMessages = false;
        const currentSelectedMessageId = state.selectedTelegramMessageId;
        const visibleMessages = getVisibleTelegramMessages(chatId);
        const shouldPreserveSelectedMessage =
          previousActiveTelegramChatId === chatId && !forceScroll;
        state.selectedTelegramMessageId =
          shouldPreserveSelectedMessage &&
          currentSelectedMessageId &&
          visibleMessages.some((message) => message.id === currentSelectedMessageId)
            ? currentSelectedMessageId
            : messages[messages.length - 1]?.id ?? null;
        syncTelegramActiveChatExposure();
        state.telegramMessagesLoading = false;
        if (changed || pendingChanged || forceScroll || showLoadingState) {
          telegramForceScrollBottom = true;
          render();
        }
        endMeasure();
        scheduleTelegramReadAcknowledgement();

        if (attempt === 0 && messages.length <= 1) {
          if (telegramMessagesHydrationTimer !== null) {
            window.clearTimeout(telegramMessagesHydrationTimer);
          }
          telegramMessagesHydrationTimer = window.setTimeout(() => {
            telegramMessagesHydrationTimer = null;
            if (state.activeTelegramChatId === chatId) {
              void loadTelegramMessages(chatId, 1, forceScroll, suppressNotification);
            }
          }, 220);
        }
      } catch (error) {
        if (!telegramController.isCurrentMessagesRequest(requestSeq) || chatId !== state.activeTelegramChatId) {
          return;
        }
        endMeasure();
        state.telegramMessagesLoading = false;
        telegramLoadingOlderMessages = false;
        telegramHasOlderMessages = false;
        state.telegramMessages = [];
        telegramMessagesVersion += 1;
        state.selectedTelegramMessageId = null;
        state.telegramLoadError =
          error instanceof Error ? error.message : 'Failed to load Telegram messages.';
        render();
      }
    });
  };

  const loadOlderTelegramMessages = async (): Promise<void> => {
    const chatId = state.activeTelegramChatId;
    const oldestLoadedMessageId = state.telegramMessages[0]?.id;
    if (
      !chatId ||
      !oldestLoadedMessageId ||
      state.telegramMessagesLoading ||
      telegramLoadingOlderMessages ||
      !telegramHasOlderMessages
    ) {
      return;
    }

    telegramLoadingOlderMessages = true;
    render();

    try {
      const olderMessages = await window.pelec.listConnectorMessages('telegram', chatId, {
        beforeMessageId: oldestLoadedMessageId,
        limit: TELEGRAM_MESSAGES_PAGE_SIZE,
        passive: true,
      });

      if (chatId !== state.activeTelegramChatId) {
        return;
      }

      telegramHasOlderMessages = olderMessages.length > 0;
      telegramLoadingOlderMessages = false;

      if (olderMessages.length < 1) {
        render();
        return;
      }

      const nextMessages = mergeTelegramMessages(state.telegramMessages, olderMessages, 'prepend-history');
      if (areMessageListsEqual(state.telegramMessages, nextMessages)) {
        render();
        return;
      }

      state.telegramMessages = nextMessages;
      telegramMessagesVersion += 1;
      render();
    } catch {
      if (chatId === state.activeTelegramChatId) {
        telegramLoadingOlderMessages = false;
        render();
      }
    }
  };

  const selectTelegramChat = (
    chatId: string,
    options: {
      forceScroll?: boolean;
      suppressNotification?: boolean;
      showLoadingState?: boolean;
    } = {},
  ): Promise<void> => {
    state.selectedTelegramChatId = chatId;
    clearTelegramReplyState({ clearAttachments: true });
    state.vimPane = 'telegram-chats';
    return loadTelegramMessages(
      chatId,
      0,
      options.forceScroll ?? true,
      options.suppressNotification ?? false,
      options.showLoadingState ?? true,
    );
  };

  const loadTelegramChats = async (
    options: {
      refreshActiveMessages?: boolean;
    } = {},
  ): Promise<void> => {
    return telegramController.refreshChats(async () => {
      const endMeasure = beginMeasure('telegram.chats.load');
      const requestSeq = telegramController.beginChatsRequest();
      const telegramStatus = getStatusByNetwork('telegram');
      if (!(telegramStatus.mode === 'native' && telegramStatus.authState === 'authenticated')) {
        resetNotificationTracking('telegram');
        state.telegramChats = [];
        state.telegramMessages = [];
        telegramHasOlderMessages = false;
        telegramLoadingOlderMessages = false;
        pendingTelegramMessagesByChat.clear();
        telegramAudioUrlCache.clear();
        telegramVideoUrlCache.clear();
        telegramController.clearMessageRefresh();
        telegramChatsVersion += 1;
        telegramMessagesVersion += 1;
        state.activeTelegramChatId = null;
        state.selectedTelegramChatId = null;
        state.selectedTelegramMessageId = null;
        clearTelegramReplyState({ clearAttachments: true });
        state.telegramMessagesLoading = false;
        state.telegramLoadError = null;
        syncTelegramActiveChatExposure();
        render();
        endMeasure();
        return;
      }

      const hasExistingChats = state.telegramChats.length > 0;
      state.telegramLoading = !hasExistingChats;
      if (!hasExistingChats) {
        render();
      }

      try {
        const chats = await window.pelec.listConnectorChats('telegram');
        if (!telegramController.isCurrentChatsRequest(requestSeq)) {
          return;
        }
        const chatsChanged = !areChatListsEqual(state.telegramChats, chats);
        if (chatsChanged) {
          state.telegramChats = chats;
          telegramChatsVersion += 1;
        }
        state.telegramLoading = false;
        state.telegramLoadError = null;
        const suppressNotifications = !notificationBaselineReady.telegram;

        if (!state.activeTelegramChatId && chats.length > 0) {
          state.activeTelegramChatId = chats[0].id;
        }
        if (!state.selectedTelegramChatId && chats.length > 0) {
          state.selectedTelegramChatId = chats[0].id;
        }
        if (
          state.selectedTelegramChatId &&
          !chats.some((chat) => chat.id === state.selectedTelegramChatId)
        ) {
          state.selectedTelegramChatId = chats[0]?.id ?? null;
        }
        if (
          state.activeTelegramChatId &&
          !chats.some((chat) => chat.id === state.activeTelegramChatId)
        ) {
          telegramController.clearMessageRefresh(state.activeTelegramChatId);
          state.activeTelegramChatId = chats[0]?.id ?? null;
          state.telegramMessages = [];
          telegramHasOlderMessages = false;
          telegramLoadingOlderMessages = false;
          telegramMessagesVersion += 1;
          state.selectedTelegramMessageId = null;
        }

        if (state.mode === 'insert' && !activeTelegramChatCanSend()) {
          state.mode = 'normal';
        }

        if (chatsChanged) {
          render();
        }

        if (state.activeTelegramChatId && options.refreshActiveMessages !== false) {
          await loadTelegramMessages(state.activeTelegramChatId, 0, false, suppressNotifications);
        }

        if (!telegramNotificationScanInFlight) {
          telegramNotificationScanInFlight = true;
          try {
            await scanChatsForNotifications(
              'telegram',
              chats,
              state.activeTelegramChatId,
              suppressNotifications,
            );
          } finally {
            telegramNotificationScanInFlight = false;
          }
        }

        if (suppressNotifications) {
          notificationBaselineReady.telegram = true;
        }

        if (
          getStatusByNetwork('telegram').mode === 'native' &&
          getStatusByNetwork('telegram').authState === 'authenticated'
        ) {
          scheduleBackgroundRefresh('telegram');
        }

        render();
        endMeasure();
      } catch (error) {
        if (!telegramController.isCurrentChatsRequest(requestSeq)) {
          return;
        }
        state.telegramLoading = false;
        state.telegramMessagesLoading = false;
        state.telegramLoadError =
          error instanceof Error ? error.message : 'Failed to load Telegram chats.';
        endMeasure();
        render();
      }
    });
  };

  const loadInstagramMessages = async (chatId: string): Promise<void> => {
    return instagramController.refreshMessages(chatId, async () => {
      const endMeasure = beginMeasure('instagram.messages.load');
      const requestSeq = instagramController.beginMessagesRequest();
      try {
        state.activeInstagramChatId = chatId;
        const messages = await window.pelec.listConnectorMessages('instagram', chatId);
        if (!instagramController.isCurrentMessagesRequest(requestSeq) || chatId !== state.activeInstagramChatId) {
          return;
        }
        const changed = !areMessageListsEqual(state.instagramMessages, messages);
        const chatTitle =
          state.instagramChats.find((chat) => chat.id === chatId)?.title ?? 'Instagram';
        maybeNotifyNewMessages('instagram', chatId, chatTitle, messages);
        state.instagramMessages = messages;
        state.selectedInstagramMessageId = messages[messages.length - 1]?.id ?? null;
        if (changed) {
          render();
        }
        endMeasure();
      } catch (error) {
        endMeasure();
        throw error;
      }
    });
  };

  const loadInstagramChats = async (
    options: {
      refreshActiveMessages?: boolean;
    } = {},
  ): Promise<void> => {
    return instagramController.refreshChats(async () => {
      const endMeasure = beginMeasure('instagram.chats.load');
      const requestSeq = instagramController.beginChatsRequest();
      try {
        if (!isInstagramNativeReady()) {
          resetNotificationTracking('instagram');
          state.instagramChats = [];
          state.instagramMessages = [];
          instagramController.clearMessageRefresh();
          state.activeInstagramChatId = null;
          state.selectedInstagramChatId = null;
          state.selectedInstagramMessageId = null;
          state.replyingToInstagramMessageId = null;
          state.replyingToInstagramSender = null;
          render();
          endMeasure();
          return;
        }

        const hasExistingChats = state.instagramChats.length > 0;
        state.instagramLoading = !hasExistingChats;
        if (!hasExistingChats) {
          render();
        }

        const chats = await window.pelec.listConnectorChats('instagram');
        if (!instagramController.isCurrentChatsRequest(requestSeq)) {
          return;
        }

        const chatsChanged = !areChatListsEqual(state.instagramChats, chats);
        state.instagramChats = chats;
        state.instagramLoading = false;
        const suppressNotifications = !notificationBaselineReady.instagram;

        if (!state.activeInstagramChatId && chats.length > 0) {
          state.activeInstagramChatId = chats[0].id;
        }
        if (!state.selectedInstagramChatId && chats.length > 0) {
          state.selectedInstagramChatId = chats[0].id;
        }
        if (
          state.selectedInstagramChatId &&
          !chats.some((chat) => chat.id === state.selectedInstagramChatId)
        ) {
          state.selectedInstagramChatId = chats[0]?.id ?? null;
        }
        if (
          state.activeInstagramChatId &&
          !chats.some((chat) => chat.id === state.activeInstagramChatId)
        ) {
          instagramController.clearMessageRefresh(state.activeInstagramChatId);
          state.activeInstagramChatId = chats[0]?.id ?? null;
          state.instagramMessages = [];
          state.selectedInstagramMessageId = null;
        }

        if (chatsChanged) {
          render();
        }

        if (state.activeInstagramChatId && options.refreshActiveMessages !== false) {
          await loadInstagramMessages(state.activeInstagramChatId);
        }

        if (!instagramNotificationScanInFlight) {
          instagramNotificationScanInFlight = true;
          try {
            await scanChatsForNotifications(
              'instagram',
              chats,
              state.activeInstagramChatId,
              suppressNotifications,
            );
          } finally {
            instagramNotificationScanInFlight = false;
          }
        }

        if (suppressNotifications) {
          notificationBaselineReady.instagram = true;
        }

        if (isInstagramNativeReady()) {
          scheduleBackgroundRefresh('instagram');
        }
      } finally {
        state.instagramLoading = false;
        endMeasure();
      }
    });
  };

  const scheduleBackgroundRefresh = (network: NetworkId): void => {
    if (network === 'instagram' && !instagramEnabled) {
      if (instagramBackgroundRefreshTimer !== null) {
        window.clearTimeout(instagramBackgroundRefreshTimer);
        instagramBackgroundRefreshTimer = null;
      }
      return;
    }
    const status = getStatusByNetwork(network);
    const delayMs = resolveRefreshDelay({
      activeNetwork: state.activeNetwork,
      authState: status.authState,
      focused: windowHasFocus,
      mode: status.mode,
      network,
      visible: documentVisible,
    });
    const currentTimer =
      network === 'telegram' ? telegramBackgroundRefreshTimer : instagramBackgroundRefreshTimer;

    if (delayMs === null) {
      if (currentTimer !== null) {
        window.clearTimeout(currentTimer);
      }
      if (network === 'telegram') {
        telegramBackgroundRefreshTimer = null;
      } else {
        instagramBackgroundRefreshTimer = null;
      }
      return;
    }

    if (currentTimer !== null) {
      window.clearTimeout(currentTimer);
    }

    const nextTimer = window.setTimeout(() => {
      const refreshMessages = shouldRefreshActiveMessages({
        activeNetwork: state.activeNetwork,
        focused: windowHasFocus,
        network,
        visible: documentVisible,
      });
      if (network === 'telegram') {
        telegramBackgroundRefreshTimer = null;
        void loadTelegramChats({ refreshActiveMessages: refreshMessages });
      } else {
        instagramBackgroundRefreshTimer = null;
        void loadInstagramChats({ refreshActiveMessages: refreshMessages });
      }
    }, delayMs);

    if (network === 'telegram') {
      telegramBackgroundRefreshTimer = nextTimer;
    } else {
      instagramBackgroundRefreshTimer = nextTimer;
    }
  };

  const ensureBackgroundRefreshLoops = (): void => {
    scheduleBackgroundRefresh('telegram');
    if (instagramEnabled) {
      scheduleBackgroundRefresh('instagram');
    }
  };

  const refreshConnectorStatuses = async (): Promise<void> => {
    const next = await window.pelec.getConnectorStatuses();
    state.connectorStatuses = Object.fromEntries(
      next.map((status) => [status.network, status]),
    ) as Record<NetworkId, ConnectorStatus>;

    let qrAuthUpdated = false;
    if (qrAuthState) {
      const qrStatus = state.connectorStatuses[qrAuthState.network];
      if (qrStatus?.qrLink && qrStatus.qrLink !== qrAuthState.qrLink) {
        qrAuthState = {
          ...qrAuthState,
          qrLink: qrStatus.qrLink,
        };
        qrAuthUpdated = true;
      }
    }

    ensureBackgroundRefreshLoops();
    if (instagramEnabled) {
      ensureInstagramWebFallbackMonitor();
      const instagramStatus = state.connectorStatuses.instagram;
      if (
        checkpointInDetails(instagramStatus?.lastError) ||
        checkpointInDetails(instagramStatus?.details)
      ) {
        if (!isInstagramCheckpointCooldownActive()) {
          setInstagramCheckpointCooldown(instagramStatus.lastError ?? instagramStatus.details);
        }
      }
    }

    if (qrAuthUpdated) {
      render();
    }

    for (const network of appConfig.networks) {
      const connectorStatus = getStatusByNetwork(network.id);
      const webview = webviewMap.get(network.id);
      const shouldPreserveActiveWebview =
        network.id === state.activeNetwork &&
        (network.id === 'instagram' || network.id === 'telegram');
      if (
        webview &&
        !shouldPreserveActiveWebview &&
        connectorStatus.webUrl &&
        webview.getAttribute('src') !== connectorStatus.webUrl
      ) {
        webview.setAttribute('src', connectorStatus.webUrl);
      }
    }
  };

  const setMode = (mode: AppMode): void => {
    const requestedMode = mode === 'command' ? 'normal' : mode;
    const normalizedMode =
      requestedMode === 'insert' &&
      state.activeNetwork === 'telegram' &&
      !activeTelegramChatCanSend()
        ? 'normal'
        : requestedMode;
    state.mode = normalizedMode;
    if (normalizedMode === 'normal') {
      telegramComposeInput.blur();
      quickFilter.blur();
      commandInput.blur();
    } else {
      if (state.activeNetwork === 'telegram') {
        state.vimPane = 'telegram-messages';
        telegramComposeInput.focus();
      } else {
        const activeWebview = webviewMap.get(state.activeNetwork);
        if (activeWebview) {
          activeWebview.focus();
        } else {
          quickFilter.focus();
        }
      }
    }
    render();
  };

  const visibleNetworks = (): NetworkDefinition[] => {
    const keyword = quickFilter.value.trim().toLowerCase();
    if (!keyword) {
      return appConfig.networks;
    }
    return appConfig.networks.filter((network) =>
      network.name.toLowerCase().includes(keyword),
    );
  };

  const activateNetwork = (id: NetworkId): void => {
    if (!appConfig.networks.some((network) => network.id === id)) {
      return;
    }
    state.activeNetwork = id;
    state.selectedNetwork = id;
    statusBar.textContent = `Active ${getNetworkById(id).name}`;

    if (id === 'telegram') {
      for (const webview of webviewMap.values()) {
        webview.blur?.();
      }
      state.vimPane = 'telegram-chats';
      void loadTelegramChats();
    } else if (id === 'instagram') {
      state.vimPane = isInstagramNativeReady() && !NETWORK_RAIL_VISIBLE
        ? 'instagram-chats'
        : 'networks';
    } else {
      state.vimPane = 'networks';
    }

    syncTelegramActiveChatExposure();
    render();

    if (id === 'telegram') {
      scheduleTelegramKeyboardSurfaceFocus();
      scheduleTelegramReadAcknowledgement();
    }
  };

  const mergeTelegramAttachments = (attachments: PendingTelegramAttachment[]): void => {
    if (attachments.length < 1) {
      return;
    }

    const availableSlots = Math.max(0, TELEGRAM_MAX_ATTACHMENTS - state.pendingTelegramAttachments.length);
    const accepted = attachments.slice(0, availableSlots);
    const skippedCount = attachments.length - accepted.length;
    state.pendingTelegramAttachments = [...state.pendingTelegramAttachments, ...accepted];

    if (accepted.length < 1) {
      statusBar.textContent = `Attachment limit reached (${TELEGRAM_MAX_ATTACHMENTS}).`;
      render();
      return;
    }

    if (skippedCount > 0) {
      statusBar.textContent = `Added ${accepted.length} attachment${accepted.length === 1 ? '' : 's'}. Skipped ${skippedCount} over the ${TELEGRAM_MAX_ATTACHMENTS}-item limit.`;
    } else {
      const firstAttachmentLabel =
        accepted[0]?.kind === 'image'
          ? 'Image'
          : accepted[0]?.kind === 'voice'
            ? 'Voice note'
            : 'File';
      statusBar.textContent =
        accepted.length === 1
          ? `${firstAttachmentLabel} attached.`
          : `${accepted.length} attachments ready to send.`;
    }

    setMode('insert');
    telegramComposeInput.focus();
    render();
  };

  const createPendingTelegramAttachment = async (
    file: File,
  ): Promise<PendingTelegramAttachment | { error: string }> => {
    if (file.size < 1) {
      return { error: `${safeLabel(file.name, 'Unnamed file')} is empty.` };
    }

    if (file.size > TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES) {
      return {
        error: `${safeLabel(file.name, 'Unnamed file')} exceeds ${Math.round(
          TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024),
        )} MB.`,
      };
    }

    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      return { error: `Failed to read ${safeLabel(file.name, 'attachment')}.` };
    }

    return {
      id: createTelegramAttachmentId(),
      kind: getTelegramAttachmentKind(file.type),
      name: safeLabel(file.name, 'attachment'),
      mimeType: file.type || undefined,
      sizeBytes: file.size > 0 ? file.size : undefined,
      dataUrl,
    };
  };

  const appendTelegramFiles = async (
    files: File[],
    sourceLabel: 'pasted' | 'selected',
  ): Promise<void> => {
    if (files.length < 1) {
      return;
    }

    const results = await Promise.all(files.map((file) => createPendingTelegramAttachment(file)));
    const attachments = results.filter(
      (result): result is PendingTelegramAttachment => 'id' in result,
    );
    const errors = results
      .filter((result): result is { error: string } => 'error' in result)
      .map((result) => result.error);

    mergeTelegramAttachments(attachments);

    if (attachments.length < 1 && errors.length > 0) {
      statusBar.textContent = errors[0] ?? `Failed to read ${sourceLabel} attachment.`;
      return;
    }

    if (errors.length > 0) {
      statusBar.textContent = `${attachments.length} ${sourceLabel} attachment${attachments.length === 1 ? '' : 's'} added. ${errors[0]}`;
    } else if (attachments.length > 0) {
      const firstAttachmentLabel =
        attachments[0]?.kind === 'image'
          ? 'Image'
          : attachments[0]?.kind === 'voice'
            ? 'Voice note'
            : 'File';
      statusBar.textContent =
        attachments.length === 1
          ? `${firstAttachmentLabel} ${sourceLabel}. Type a caption, then press send.`
          : `${attachments.length} attachments ${sourceLabel}. Type a caption, then press send.`;
    }

    render();
  };

  let telegramVoiceRecorder: MediaRecorder | null = null;
  let telegramVoiceRecorderStream: MediaStream | null = null;
  let telegramVoiceRecorderChunks: Blob[] = [];
  let telegramVoiceRecorderMimeType: string | null = null;
  let telegramVoiceRecorderStartAt = 0;
  let telegramVoiceRecorderStartToken = 0;
  let telegramVoiceRecorderBusy = false;
  let telegramVoiceRecorderBusyReason: 'preparing' | 'sending' | null = null;
  let telegramVoiceRecorderCancelled = false;
  let telegramVoiceRecorderStopping = false;

  const updateTelegramVoiceRecorderUi = (): void => {
    const isRecording = telegramVoiceRecorder !== null;
    const isPreparing = telegramVoiceRecorderBusyReason === 'preparing';
    const isSending = telegramVoiceRecorderBusyReason === 'sending';
    telegramVoiceRecordButton.classList.toggle('recording', isRecording);
    telegramVoiceRecordButton.disabled = isPreparing || isSending;
    telegramVoiceRecordButton.textContent = isRecording ? '■' : '●';
    telegramVoiceRecordButton.setAttribute(
      'aria-label',
      isRecording
        ? 'Stop and send voice note'
        : isPreparing
          ? 'Preparing microphone'
          : isSending
            ? 'Sending voice note'
            : 'Record a voice note',
    );
    telegramVoiceRecordButton.title = isRecording
      ? 'Stop and send voice note'
      : isPreparing
        ? 'Preparing microphone'
        : isSending
          ? 'Sending voice note'
          : 'Record a voice note';
    emitSnapshotChange();
  };

  const cleanupTelegramVoiceRecorderStream = (): void => {
    telegramVoiceRecorderStream?.getTracks().forEach((track) => {
      track.stop();
    });
    telegramVoiceRecorderStream = null;
  };

  const resetTelegramVoiceRecorder = (): void => {
    telegramVoiceRecorder = null;
    telegramVoiceRecorderChunks = [];
    telegramVoiceRecorderMimeType = null;
    telegramVoiceRecorderStartAt = 0;
    telegramVoiceRecorderBusy = false;
    telegramVoiceRecorderBusyReason = null;
    telegramVoiceRecorderCancelled = false;
    telegramVoiceRecorderStopping = false;
    cleanupTelegramVoiceRecorderStream();
    updateTelegramVoiceRecorderUi();
  };

  const markTelegramVoiceRecorderStopped = (): {
    cancelled: boolean;
    chunks: Blob[];
    mimeType: string | null;
    durationMs: number;
  } => {
    const chunks = [...telegramVoiceRecorderChunks];
    const mimeType = telegramVoiceRecorderMimeType;
    const cancelled = telegramVoiceRecorderCancelled;
    const durationMs = Date.now() - telegramVoiceRecorderStartAt;

    telegramVoiceRecorder = null;
    telegramVoiceRecorderChunks = [];
    telegramVoiceRecorderMimeType = null;
    telegramVoiceRecorderStartAt = 0;
    telegramVoiceRecorderBusyReason = null;
    telegramVoiceRecorderCancelled = false;
    telegramVoiceRecorderStopping = false;
    cleanupTelegramVoiceRecorderStream();
    updateTelegramVoiceRecorderUi();

    return {
      cancelled,
      chunks,
      mimeType,
      durationMs,
    };
  };

  const sendRecordedTelegramVoiceNote = async (
    blob: Blob,
    mimeType: string,
    durationMs: number,
  ): Promise<void> => {
    if (state.activeNetwork !== 'telegram' || !state.activeTelegramChatId) {
      statusBar.textContent = 'Open a Telegram chat before sending a voice note.';
      resetTelegramVoiceRecorder();
      return;
    }

    if (durationMs < TELEGRAM_VOICE_RECORDING_MIN_DURATION_MS || blob.size < 1) {
      statusBar.textContent = 'Voice note too short.';
      resetTelegramVoiceRecorder();
      return;
    }

    const dataUrl = await readBlobAsDataUrl(blob);
    if (!dataUrl) {
      statusBar.textContent = 'Failed to prepare the voice note.';
      resetTelegramVoiceRecorder();
      return;
    }

    telegramVoiceRecorderBusy = true;
    telegramVoiceRecorderBusyReason = 'sending';
    updateTelegramVoiceRecorderUi();
    statusBar.textContent = 'Processing voice note...';

    const chatId = state.activeTelegramChatId;
    const replyToMessageId = state.replyingToMessageId ?? undefined;
    const sent = await window.pelec.sendConnectorVoice(
      'telegram',
      chatId,
      {
        dataUrl,
        fileName: getTelegramVoiceRecordingFileName(mimeType),
        mimeType,
      },
      replyToMessageId,
    );

    if (!sent) {
      await refreshConnectorStatuses();
      const status = getStatusByNetwork('telegram');
      const failureMessage =
        status.lastError?.trim() ||
        status.details?.trim() ||
        'Voice note preparation failed.';
      statusBar.textContent = `Failed to send: ${failureMessage}`;
      resetTelegramVoiceRecorder();
      render();
      return;
    }

    clearTelegramReplyState();
    telegramForceScrollBottom = true;
    scheduleTelegramMessagesRefresh(chatId, 0);
    scheduleTelegramChatsRefresh(0, false);
    statusBar.textContent = 'Voice note sent.';
    resetTelegramVoiceRecorder();
    render();
  };

  const stopTelegramVoiceRecording = (): void => {
    const recorder = telegramVoiceRecorder;
    if (!recorder) {
      return;
    }

    if (telegramVoiceRecorderStopping) {
      return;
    }

    telegramVoiceRecorderStopping = true;

    try {
      recorder.requestData();
    } catch {
      // Best-effort flush before stopping.
    }

    recorder.stop();
  };

  const cancelTelegramVoiceRecording = (): void => {
    telegramVoiceRecorderStartToken += 1;
    if (telegramVoiceRecorder) {
      telegramVoiceRecorderCancelled = true;
      stopTelegramVoiceRecording();
      statusBar.textContent = 'Voice note canceled.';
      render();
      return;
    }

    if (telegramVoiceRecorderBusyReason === 'preparing' || telegramVoiceRecorderBusy) {
      resetTelegramVoiceRecorder();
      statusBar.textContent = 'Voice note canceled.';
      render();
    }
  };

  const startTelegramVoiceRecording = async (): Promise<void> => {
    if (telegramVoiceRecorderBusy || telegramVoiceRecorder) {
      return;
    }
    if (state.activeNetwork !== 'telegram' || !state.activeTelegramChatId) {
      statusBar.textContent = 'Open a Telegram chat before recording a voice note.';
      return;
    }

    const mimeType = getSupportedTelegramVoiceRecordingMimeType();
    if (!mimeType) {
      statusBar.textContent = 'Voice recording is not supported in this build.';
      return;
    }

    telegramVoiceRecorderBusy = true;
    telegramVoiceRecorderBusyReason = 'preparing';
    telegramVoiceRecorderCancelled = false;
    telegramVoiceRecorderStartToken += 1;
    const startToken = telegramVoiceRecorderStartToken;
    updateTelegramVoiceRecorderUi();
    statusBar.textContent = 'Preparing microphone...';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (telegramVoiceRecorderStartToken !== startToken) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      telegramVoiceRecorder = recorder;
      telegramVoiceRecorderStream = stream;
      telegramVoiceRecorderChunks = [];
      telegramVoiceRecorderMimeType = mimeType;
      telegramVoiceRecorderStartAt = Date.now();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          telegramVoiceRecorderChunks.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const stopped = markTelegramVoiceRecorderStopped();
        if (stopped.cancelled) {
          return;
        }
        const recordedMimeType = stopped.mimeType ?? mimeType;
        const blob = new Blob(stopped.chunks, {
          type: recordedMimeType,
        });
        void sendRecordedTelegramVoiceNote(blob, recordedMimeType, stopped.durationMs);
      });

      recorder.addEventListener('error', () => {
        statusBar.textContent = 'Voice recording failed.';
        resetTelegramVoiceRecorder();
        render();
      });

      recorder.start();
      telegramVoiceRecorderBusy = false;
      telegramVoiceRecorderBusyReason = null;
      updateTelegramVoiceRecorderUi();
      statusBar.textContent = 'Recording voice note. Press stop to send or cancel to discard.';
    } catch (error) {
      telegramVoiceRecorderBusy = false;
      telegramVoiceRecorderBusyReason = null;
      updateTelegramVoiceRecorderUi();
      statusBar.textContent =
        error instanceof Error ? `Microphone failed: ${error.message}` : 'Microphone access failed.';
    }
  };

  const sendTelegramMessage = async (): Promise<void> => {
    if (state.activeNetwork !== 'telegram' || !state.activeTelegramChatId) {
      return;
    }
    if (!activeTelegramChatCanSend()) {
      statusBar.textContent = 'You cannot post in this channel.';
      render();
      return;
    }

    const chatId = state.activeTelegramChatId;
    const text = telegramComposeInput.value.trim();
    const attachments = [...state.pendingTelegramAttachments];
    const hasAttachments = attachments.length > 0;
    const hasVoiceAttachments = attachments.some((attachment) => attachment.kind === 'voice');
    if (!text && !hasAttachments) {
      return;
    }

    closeTelegramEmojiCompletion();
    telegramSendButton.disabled = true;
    try {
      const replyToMessageId = state.replyingToMessageId ?? undefined;
      const replyTarget = findTelegramMessageById(replyToMessageId ?? null);
      const previousComposeValue = telegramComposeInput.value;
      const previousPendingAttachments = [...state.pendingTelegramAttachments];
      const previousReplyingToMessageId = state.replyingToMessageId;
      const previousReplyingToSender = state.replyingToSender;
      const pendingMessage = !hasAttachments
        ? createPendingTelegramMessage(chatId, {
            sender: 'You',
            text,
            timestamp: Date.now(),
            replyToMessageId,
            replyToSender: replyTarget?.sender,
            replyToText: replyTarget ? buildTelegramMessageActionText(replyTarget) : undefined,
          })
        : null;

      if (pendingMessage) {
        addPendingTelegramMessages(pendingMessage);
        telegramComposeInput.value = '';
        syncTelegramComposeInputHeight();
        clearTelegramReplyState();
        state.selectedTelegramMessageId = pendingMessage.id;
        telegramForceScrollBottom = true;
        render();
      }

      let sent = true;
      if (hasAttachments) {
        if (text && hasVoiceAttachments) {
          sent = await window.pelec.sendConnectorMessage(
            'telegram',
            chatId,
            text,
            replyToMessageId,
          );
        }
        for (let index = 0; index < attachments.length; index += 1) {
          if (!sent) {
            break;
          }
          const attachment = attachments[index];
          if (!attachment) {
            continue;
          }
          const caption = !hasVoiceAttachments && index === 0 ? text : '';
          const attachmentSent =
            attachment.kind === 'image'
              ? await window.pelec.sendConnectorImage(
                  'telegram',
                  chatId,
                  attachment.dataUrl,
                  caption,
                  replyToMessageId,
                )
              : attachment.kind === 'voice'
                ? await window.pelec.sendConnectorVoice(
                    'telegram',
                    chatId,
                    {
                      dataUrl: attachment.dataUrl,
                      fileName: attachment.name,
                      mimeType: attachment.mimeType,
                    },
                    replyToMessageId,
                  )
              : await window.pelec.sendConnectorDocument(
                  'telegram',
                  chatId,
                  {
                    dataUrl: attachment.dataUrl,
                    fileName: attachment.name,
                    mimeType: attachment.mimeType,
                  },
                  caption,
                  replyToMessageId,
                );
          if (!attachmentSent) {
            sent = false;
            break;
          }
        }
      } else {
        sent = await window.pelec.sendConnectorMessage(
          'telegram',
          chatId,
          text,
          replyToMessageId,
        );
      }
      if (!sent) {
        if (pendingMessage) {
          removePendingTelegramMessages(chatId, (message) => message.id === pendingMessage.id);
          telegramComposeInput.value = previousComposeValue;
          syncTelegramComposeInputHeight();
          updateTelegramEmojiCompletion();
          state.pendingTelegramAttachments = previousPendingAttachments;
          state.replyingToMessageId = previousReplyingToMessageId;
          state.replyingToSender = previousReplyingToSender;
          if (state.selectedTelegramMessageId === pendingMessage.id) {
            state.selectedTelegramMessageId = state.telegramMessages[state.telegramMessages.length - 1]?.id ?? null;
          }
        }
        await refreshConnectorStatuses();
        const status = getStatusByNetwork('telegram');
        statusBar.textContent = `Failed to send: ${status.lastError ?? status.details}`;
        render();
        return;
      }

      if (!pendingMessage) {
        telegramComposeInput.value = '';
        syncTelegramComposeInputHeight();
        state.pendingTelegramAttachments = [];
        clearTelegramReplyState();
      }
      telegramForceScrollBottom = true;
      render();
      scheduleTelegramMessagesRefresh(chatId, pendingMessage ? 90 : 0);
      scheduleTelegramChatsRefresh(0, false);
    } finally {
      telegramSendButton.disabled = false;
    }
  };

  const scheduleTelegramChatsRefresh = (
    delayMs = 300,
    refreshActiveMessages = true,
  ): void => {
    if (telegramChatsRefreshTimer !== null) {
      window.clearTimeout(telegramChatsRefreshTimer);
    }
    telegramChatsRefreshTimer = window.setTimeout(() => {
      telegramChatsRefreshTimer = null;
      void loadTelegramChats({ refreshActiveMessages });
    }, delayMs);
  };

  const scheduleTelegramMessagesRefresh = (chatId: string, delayMs = 220): void => {
    if (telegramMessagesRefreshTimer !== null) {
      window.clearTimeout(telegramMessagesRefreshTimer);
    }
    telegramMessagesRefreshTimer = window.setTimeout(() => {
      telegramMessagesRefreshTimer = null;
      void loadTelegramMessages(chatId);
    }, delayMs);
  };

  const scheduleInstagramChatsRefresh = (delayMs = 450): void => {
    if (instagramChatsRefreshTimer !== null) {
      window.clearTimeout(instagramChatsRefreshTimer);
    }
    instagramChatsRefreshTimer = window.setTimeout(() => {
      instagramChatsRefreshTimer = null;
      void loadInstagramChats();
    }, delayMs);
  };

  const scheduleInstagramMessagesRefresh = (chatId: string, delayMs = 350): void => {
    if (instagramMessagesRefreshTimer !== null) {
      window.clearTimeout(instagramMessagesRefreshTimer);
    }
    instagramMessagesRefreshTimer = window.setTimeout(() => {
      instagramMessagesRefreshTimer = null;
      void loadInstagramMessages(chatId);
    }, delayMs);
  };

  const moveSelection = (direction: 1 | -1): void => {
    if (!NETWORK_RAIL_VISIBLE) {
      return;
    }
    const list = visibleNetworks();
    if (list.length < 1) {
      return;
    }
    const currentIndex = list.findIndex(
      (network) => network.id === state.selectedNetwork,
    );
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.min(list.length - 1, Math.max(0, safeIndex + direction));
    state.selectedNetwork = list[nextIndex].id;
    render();
  };

  const moveSelectionByPage = (direction: 1 | -1): void => {
    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-chats') {
      if (state.telegramChats.length < 1) {
        return;
      }
      const step = Math.max(1, Math.floor(state.telegramChats.length / 4));
      const currentIndex = state.telegramChats.findIndex((chat) => chat.id === state.selectedTelegramChatId);
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.min(
        state.telegramChats.length - 1,
        Math.max(0, safeIndex + direction * step),
      );
      state.selectedTelegramChatId = state.telegramChats[nextIndex].id;
      render();
      return;
    }

    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
      const telegramMessages = getVisibleTelegramMessages();
      if (telegramMessages.length < 1) {
        return;
      }
      const step = Math.max(1, Math.floor(telegramMessages.length / 4));
      const currentIndex = telegramMessages.findIndex(
        (message) => message.id === state.selectedTelegramMessageId,
      );
      const safeIndex = currentIndex === -1 ? telegramMessages.length - 1 : currentIndex;
      const nextIndex = Math.min(
        telegramMessages.length - 1,
        Math.max(0, safeIndex + direction * step),
      );
      state.selectedTelegramMessageId = telegramMessages[nextIndex].id;
      render();
      return;
    }

    if (state.activeNetwork === 'instagram' && state.vimPane === 'instagram-chats') {
      if (state.instagramChats.length < 1) {
        return;
      }
      const step = Math.max(1, Math.floor(state.instagramChats.length / 4));
      const currentIndex = state.instagramChats.findIndex(
        (chat) => chat.id === state.selectedInstagramChatId,
      );
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.min(
        state.instagramChats.length - 1,
        Math.max(0, safeIndex + direction * step),
      );
      state.selectedInstagramChatId = state.instagramChats[nextIndex].id;
      render();
      return;
    }

    if (state.activeNetwork === 'instagram' && state.vimPane === 'instagram-messages') {
      if (state.instagramMessages.length < 1) {
        return;
      }
      const step = Math.max(1, Math.floor(state.instagramMessages.length / 4));
      const currentIndex = state.instagramMessages.findIndex(
        (message) => message.id === state.selectedInstagramMessageId,
      );
      const safeIndex = currentIndex === -1 ? state.instagramMessages.length - 1 : currentIndex;
      const nextIndex = Math.min(
        state.instagramMessages.length - 1,
        Math.max(0, safeIndex + direction * step),
      );
      state.selectedInstagramMessageId = state.instagramMessages[nextIndex].id;
      render();
      return;
    }

    if (!NETWORK_RAIL_VISIBLE) {
      return;
    }
    const list = visibleNetworks();
    if (list.length < 1) {
      return;
    }
    const step = Math.max(1, Math.floor(list.length / 4));
    const currentIndex = list.findIndex((network) => network.id === state.selectedNetwork);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.min(list.length - 1, Math.max(0, safeIndex + direction * step));
    state.selectedNetwork = list[nextIndex].id;
    render();
  };

  const moveSelectionToEdge = (edge: 'first' | 'last'): void => {
    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-chats') {
      if (state.telegramChats.length < 1) {
        return;
      }
      state.selectedTelegramChatId =
        edge === 'first'
          ? state.telegramChats[0].id
          : state.telegramChats[state.telegramChats.length - 1].id;
      render();
      return;
    }

    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
      const telegramMessages = getVisibleTelegramMessages();
      if (telegramMessages.length < 1) {
        return;
      }
      state.selectedTelegramMessageId =
        edge === 'first'
          ? telegramMessages[0].id
          : telegramMessages[telegramMessages.length - 1].id;
      render();
      return;
    }

    if (state.activeNetwork === 'instagram' && state.vimPane === 'instagram-chats') {
      if (state.instagramChats.length < 1) {
        return;
      }
      state.selectedInstagramChatId =
        edge === 'first'
          ? state.instagramChats[0].id
          : state.instagramChats[state.instagramChats.length - 1].id;
      render();
      return;
    }

    if (state.activeNetwork === 'instagram' && state.vimPane === 'instagram-messages') {
      if (state.instagramMessages.length < 1) {
        return;
      }
      state.selectedInstagramMessageId =
        edge === 'first'
          ? state.instagramMessages[0].id
          : state.instagramMessages[state.instagramMessages.length - 1].id;
      render();
      return;
    }

    if (!NETWORK_RAIL_VISIBLE) {
      return;
    }
    const list = visibleNetworks();
    if (list.length < 1) {
      return;
    }
    state.selectedNetwork = edge === 'first' ? list[0].id : list[list.length - 1].id;
    render();
  };

  const moveVimPane = (direction: -1 | 1): void => {
    if (
      state.activeNetwork !== 'telegram' &&
      !(state.activeNetwork === 'instagram' && isInstagramNativeReady())
    ) {
      if (NETWORK_RAIL_VISIBLE) {
        state.vimPane = 'networks';
        render();
      }
      return;
    }
    const panes = getVimPanesForActiveNetwork();
    if (panes.length < 2) {
      return;
    }
    if (!panes.includes(state.vimPane)) {
      state.vimPane = panes[0];
      render();
      return;
    }
    const currentIndex = panes.indexOf(state.vimPane);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(panes.length - 1, safeIndex + direction));
    state.vimPane = panes[nextIndex];
    render();
    if (state.activeNetwork === 'telegram' && state.mode !== 'insert') {
      scheduleTelegramKeyboardSurfaceFocus();
    }
  };

  const moveVimSelection = (direction: 1 | -1): void => {
    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-chats') {
      if (state.telegramChats.length < 1) {
        return;
      }
      const currentIndex = state.telegramChats.findIndex((chat) => chat.id === state.selectedTelegramChatId);
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.min(
        state.telegramChats.length - 1,
        Math.max(0, safeIndex + direction),
      );
      state.selectedTelegramChatId = state.telegramChats[nextIndex].id;
      render();
      return;
    }

    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
      const telegramMessages = getVisibleTelegramMessages();
      if (telegramMessages.length < 1) {
        return;
      }
      const currentIndex = telegramMessages.findIndex(
        (message) => message.id === state.selectedTelegramMessageId,
      );
      const safeIndex = currentIndex === -1 ? telegramMessages.length - 1 : currentIndex;
      const nextIndex = Math.min(
        telegramMessages.length - 1,
        Math.max(0, safeIndex + direction),
      );
      state.selectedTelegramMessageId = telegramMessages[nextIndex].id;
      render();
      return;
    }

    if (state.activeNetwork === 'instagram' && state.vimPane === 'instagram-chats') {
      if (state.instagramChats.length < 1) {
        return;
      }
      const currentIndex = state.instagramChats.findIndex(
        (chat) => chat.id === state.selectedInstagramChatId,
      );
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.min(
        state.instagramChats.length - 1,
        Math.max(0, safeIndex + direction),
      );
      state.selectedInstagramChatId = state.instagramChats[nextIndex].id;
      render();
      return;
    }

    if (state.activeNetwork === 'instagram' && state.vimPane === 'instagram-messages') {
      if (state.instagramMessages.length < 1) {
        return;
      }
      const currentIndex = state.instagramMessages.findIndex(
        (message) => message.id === state.selectedInstagramMessageId,
      );
      const safeIndex = currentIndex === -1 ? state.instagramMessages.length - 1 : currentIndex;
      const nextIndex = Math.min(
        state.instagramMessages.length - 1,
        Math.max(0, safeIndex + direction),
      );
      state.selectedInstagramMessageId = state.instagramMessages[nextIndex].id;
      render();
      return;
    }

    moveSelection(direction);
  };

  const activateVimSelection = (): void => {
    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-chats') {
      const nextChatId = state.selectedTelegramChatId;
      if (nextChatId) {
        state.activeTelegramChatId = nextChatId;
        clearTelegramReplyState({ clearAttachments: true });
        void loadTelegramMessages(nextChatId, 0, true, false, true);
      }
      return;
    }

    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
      const selected = telegramMessageListEl.querySelector<HTMLElement>('.telegram-message-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (!NETWORK_RAIL_VISIBLE) {
      return;
    }
    activateNetwork(state.selectedNetwork);
  };

  const findSelectedTelegramMessage = (): ChatMessage | undefined => {
    const message = findTelegramMessageById(state.selectedTelegramMessageId);
    return isPendingTelegramMessage(message) ? undefined : message;
  };

  const removeTelegramMessageLocally = (chatId: string, messageId: string): boolean => {
    if (state.activeTelegramChatId !== chatId) {
      return false;
    }

    const messageIndex = state.telegramMessages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return false;
    }

    const nextMessages = state.telegramMessages.filter((message) => message.id !== messageId);
    state.telegramMessages = nextMessages;
    telegramMessagesVersion += 1;

    if (state.selectedTelegramMessageId === messageId) {
      state.selectedTelegramMessageId =
        nextMessages[messageIndex]?.id ?? nextMessages[messageIndex - 1]?.id ?? null;
    }

    if (state.replyingToMessageId === messageId) {
      clearTelegramReplyState({ clearAttachments: true });
    }

    if (telegramContextMenuState.messageId === messageId) {
      closeTelegramContextMenu(false);
    }

    render();
    return true;
  };

  const deleteSelectedTelegramMessage = async (): Promise<void> => {
    if (state.activeNetwork !== 'telegram' || !state.activeTelegramChatId) {
      return;
    }
    const chatId = state.activeTelegramChatId;
    const selected = findSelectedTelegramMessage();
    if (!selected) {
      return;
    }

    removeTelegramMessageLocally(chatId, selected.id);
    statusBar.textContent = 'Deleting message...';

    const deleted = await window.pelec.deleteConnectorMessage(
      'telegram',
      chatId,
      selected.id,
    );
    if (!deleted) {
      await refreshConnectorStatuses();
      if (state.activeTelegramChatId === chatId) {
        await loadTelegramMessages(chatId);
      }
      scheduleTelegramChatsRefresh(0, false);
      const status = getStatusByNetwork('telegram');
      statusBar.textContent = `Delete failed: ${status.lastError ?? status.details}`;
      return;
    }

    scheduleTelegramMessagesRefresh(chatId, 180);
    scheduleTelegramChatsRefresh(0, false);
    statusBar.textContent = 'Message deleted.';
  };

  const beginReplyToSelectedTelegramMessage = (): void => {
    if (state.activeNetwork !== 'telegram') {
      return;
    }
    const selected = findSelectedTelegramMessage();
    if (!selected) {
      return;
    }
    beginReplyToTelegramMessage(selected);
  };

  const applyAuthResult = async (result: AuthStartResult): Promise<void> => {
    statusBar.textContent = result.instructions;

    if (result.mode === 'none') {
      await refreshConnectorStatuses();
      render();
      return;
    }

    if (result.mode === 'browser' && result.webUrl) {
      const webview = webviewMap.get(result.network);
      if (webview) {
        webview.setAttribute('src', result.webUrl);
      }
      if (result.network === 'instagram') {
        startInstagramBrowserSessionPolling();
      }
      activateNetwork(result.network);
      setMode('insert');
      await refreshConnectorStatuses();
      if (result.network === 'instagram') {
        const status = getStatusByNetwork('instagram');
        if (status.authState === 'authenticated') {
          stopInstagramBrowserSessionPolling();
          setMode('normal');
        }
      }
      render();
      return;
    }

    if (result.mode === 'password') {
      const username = await requestAuthInput({
        title: 'Instagram Login',
        stepLabel: 'Step 1 of 3',
        message: 'Enter your Instagram username.',
        label: 'Username',
        placeholder: 'Username',
        submitLabel: 'Next',
      });
      if (!username) {
        return;
      }
      const password = await requestAuthInput({
        title: 'Instagram Login',
        stepLabel: 'Step 2 of 3',
        message: `Enter password for @${username}.`,
        label: 'Password',
        placeholder: 'Password',
        secret: true,
        trim: false,
        submitLabel: 'Login',
      });
      if (!password) {
        return;
      }
      const submittedStatus = await window.pelec.submitConnectorAuth(result.network, {
        type: 'password',
        value: JSON.stringify({ username, password }),
      });
      if (
        result.network === 'instagram' &&
        submittedStatus.authState === 'authenticating'
      ) {
        const followUp = await window.pelec.startConnectorAuth(result.network);
        await applyAuthResult(followUp);
        return;
      }
      await refreshConnectorStatuses();
      if (result.network === 'instagram') {
        stopInstagramBrowserSessionPolling();
      }
      render();
      return;
    }

    if (result.mode === 'code') {
      const code = await requestAuthInput({
        title: 'Instagram Verification',
        stepLabel: 'Step 3 of 3',
        message: result.instructions,
        label: 'Verification code',
        placeholder: 'Code',
        submitLabel: 'Verify',
        onCancel: async () => {
          if (result.network === 'instagram') {
            stopInstagramBrowserSessionPolling();
            await window.pelec.resetConnectorAuth('instagram');
          }
        },
      });
      if (!code) {
        await refreshConnectorStatuses();
        render();
        return;
      }
      const submittedStatus = await window.pelec.submitConnectorAuth(result.network, {
        type: 'code',
        value: code,
      });
      statusBar.textContent = submittedStatus.lastError ?? submittedStatus.details;
      await refreshConnectorStatuses();
      if (result.network === 'instagram') {
        if (submittedStatus.authState === 'authenticated') {
          stopInstagramBrowserSessionPolling();
          setMode('normal');
        } else if (submittedStatus.mode === 'web-fallback') {
          activateNetwork('instagram');
          startInstagramBrowserSessionPolling();
        }
      }
      render();
      return;
    }

    if (result.mode === 'token') {
      const token = window.prompt('Paste Instagram Graph API access token');
      if (!token) {
        return;
      }
      await window.pelec.submitConnectorAuth(result.network, {
        type: 'token',
        value: token,
      });
      await refreshConnectorStatuses();
      render();
      return;
    }

    if (result.mode === 'qr') {
      qrAuthState = {
        network: result.network,
        passwordRequired: false,
        qrLink: result.qrLink ?? null,
      };
      startQrStatusPolling(result.network);
      setMode('normal');

      await refreshConnectorStatuses();
      render();
      return;
    }
  };

  const startAuthForNetwork = async (id: NetworkId): Promise<void> => {
    try {
      const result = await window.pelec.startConnectorAuth(id);
      console.info('[instagram-auth][renderer] start-auth result', result);
      await applyAuthResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[instagram-auth][renderer] start-auth failed', error);
      statusBar.textContent = `Auth failed: ${message}`;
      render();
    }
  };

  const availableCommands = (): AppCommand[] => [
    ...appConfig.networks.map((network) => ({
      id: `switch-${network.id}`,
      label: `switch ${network.id}`,
      group: 'network' as const,
      run: () => activateNetwork(network.id),
    })),
    ...appConfig.networks.map((network) => ({
      id: `auth-${network.id}`,
      label: `auth ${network.id}`,
      group: 'network' as const,
      run: () => {
        void startAuthForNetwork(network.id);
      },
    })),
    {
      id: 'refresh-connectors',
      label: 'refresh connectors',
      group: 'actions',
      run: () => {
        void refreshConnectorStatuses().then(async () => {
          await loadTelegramChats();
          render();
        });
      },
    },
    {
      id: 'refresh-telegram',
      label: 'refresh telegram',
      group: 'actions',
      run: () => {
        void loadTelegramChats();
      },
    },
    {
      id: 'mode-normal',
      label: 'mode normal',
      group: 'mode',
      run: () => setMode('normal'),
    },
    {
      id: 'mode-insert',
      label: 'mode insert',
      group: 'mode',
      run: () => setMode('insert'),
    },
    {
      id: 'open-browser',
      label: 'open browser',
      group: 'actions',
      run: () => {
        const active = getStatusByNetwork(state.activeNetwork);
        if (active.webUrl !== 'about:blank') {
          void window.pelec.openExternal(active.webUrl);
        }
      },
    },
    {
      id: 'test-notification',
      label: 'test notification',
      group: 'system',
      run: () => {
        void window.pelec
          .showNotification('PELEC', 'Test notification from PELEC')
          .then((ok) => {
            statusBar.textContent = ok
              ? 'Notification sent.'
              : 'Notification failed (check Linux notification daemon).';
            render();
          });
      },
    },
  ];

  const executeCommandById = (commandId: string): void => {
    const command = availableCommands().find((item) => item.id === commandId);
    if (!command) {
      statusBar.textContent = `No command: ${commandId}`;
      render();
      return;
    }

    command.run();
    statusBar.textContent = `Executed: ${command.label}`;
    render();
  };

  const focusActiveSearch = (): void => {
    if (state.activeNetwork === 'telegram') {
      telegramSearchInput.focus();
      telegramSearchInput.select();
      return;
    }

    if (NETWORK_RAIL_VISIBLE) {
      quickFilter.focus();
      quickFilter.select();
    }
  };

  const focusTelegramComposer = (): void => {
    if (!activeTelegramChatCanSend()) {
      return;
    }
    telegramComposeInput.focus();
  };

  const setTelegramSearchQuery = (query: string): void => {
    state.telegramSearchQuery = query;
    telegramSearchInput.value = query;
    render();
  };

  const setTelegramDraftValue = (value: string): void => {
    telegramComposeInput.value = value;
    syncTelegramComposeInputHeight();
    updateTelegramEmojiCompletion();
  };

  const removeTelegramAttachment = (attachmentId: string): void => {
    state.pendingTelegramAttachments = state.pendingTelegramAttachments.filter(
      (item) => item.id !== attachmentId,
    );
    render();
  };

  const handleGlobalEscape = (): void => {
    if (authPromptState) {
      cancelAuthPrompt();
      return;
    }

    if (qrAuthState) {
      hideQrModal();
      return;
    }

    if (activeTelegramImageUrl) {
      closeTelegramImagePreview();
      return;
    }

    if (telegramForwardState.visible) {
      if (!telegramForwardState.sending) {
        closeTelegramForwardMenu();
      }
      return;
    }

    if (telegramContextMenuState.visible) {
      closeTelegramContextMenu();
      return;
    }

    clearGPending();
    state.commandPaletteOpen = false;
    state.commandQuery = '';
    commandInput.value = '';
    setMode('normal');
  };

  const toggleRuntimeSendBehavior = (): 'enter' | 'mod-enter' => {
    appConfig.userConfig.keyboard.sendBehavior =
      appConfig.userConfig.keyboard.sendBehavior === 'enter' ? 'mod-enter' : 'enter';
    statusBar.textContent =
      appConfig.userConfig.keyboard.sendBehavior === 'mod-enter'
        ? 'Send mode: Mod+Enter'
        : 'Send mode: Enter';
    render();
    return appConfig.userConfig.keyboard.sendBehavior;
  };

  const executeCommandByQuery = (): void => {
    const query = state.commandQuery.trim().toLowerCase();
    if (!query) {
      return;
    }

    const command = availableCommands().find((item) =>
      item.label.startsWith(query),
    );
    if (!command) {
      statusBar.textContent = `No command: ${query}`;
      return;
    }

    command.run();
    state.commandPaletteOpen = false;
    state.commandQuery = '';
    commandInput.value = '';
    statusBar.textContent = `Executed: ${command.label}`;
    render();
  };

  const renderCommandPalette = (): void => {
    const query = state.commandQuery.trim().toLowerCase();
    const items = availableCommands().filter((item) =>
      item.label.includes(query),
    );
    commandList.replaceChildren(
      ...items.slice(0, 7).map((item) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'command-item';
        el.textContent = item.label;
        el.addEventListener('click', () => {
          item.run();
          state.commandPaletteOpen = false;
          state.commandQuery = '';
          commandInput.value = '';
          render();
        });
        return el;
      }),
    );
  };

  const buildInitials = (label: string): string => {
    const words = label
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length < 1) {
      return '?';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  };

  const createAvatarNode = (
    label: string,
    imageUrl: string | undefined,
    className: string,
  ): HTMLElement => {
    const avatar = document.createElement('div');
    avatar.className = className;

    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = `${label} avatar`;
      image.loading = 'lazy';
      avatar.append(image);
    } else {
      avatar.textContent = buildInitials(label);
      avatar.classList.add('fallback');
    }

    return avatar;
  };

  const createAnimatedMediaNode = (
    mediaUrl: string,
    mimeType: string | undefined,
    className: string,
    label: string,
  ): HTMLElement => {
    if ((mimeType ?? '').startsWith('image/')) {
      const image = document.createElement('img');
      image.className = className;
      image.src = mediaUrl;
      image.alt = label;
      image.loading = 'lazy';
      return image;
    }

    const video = document.createElement('video');
    video.className = className;
    video.src = mediaUrl;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    video.setAttribute('aria-label', label);
    return video;
  };

  const createTelegramVideoShell = (
    message: ChatMessage,
    chatId: string,
    className: string,
    label: string,
    inAlbum = false,
  ): HTMLElement => {
    type TelegramVideoPlaybackState =
      | 'idle'
      | 'loading'
      | 'playing'
      | 'failed-download'
      | 'failed-decode';

    const container = document.createElement('div');
    container.className = inAlbum ? 'telegram-message-album-video-shell' : 'telegram-message-video-shell';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'telegram-message-video-trigger';
    button.setAttribute('aria-label', label);

    const icon = document.createElement('span');
    icon.className = 'telegram-message-video-trigger-icon';
    icon.textContent = '▶';
    const text = document.createElement('span');
    text.className = 'telegram-message-video-trigger-text';
    text.textContent = 'Play video';
    button.replaceChildren(icon, text);
    container.replaceChildren(button);

    let loading = false;
    let playbackState: TelegramVideoPlaybackState = 'idle';

    const setTriggerState = (state: TelegramVideoPlaybackState): void => {
      playbackState = state;
      container.classList.remove('loading', 'failed', 'loaded');
      button.disabled = state === 'loading';
      icon.textContent = state === 'failed-decode' ? '!' : '▶';
      if (state === 'loading') {
        container.classList.add('loading');
        text.textContent = 'Loading...';
        return;
      }
      if (state === 'failed-download') {
        container.classList.add('failed');
        text.textContent = 'Retry video';
        return;
      }
      if (state === 'failed-decode') {
        container.classList.add('failed');
        text.textContent = 'Open video externally';
        return;
      }
      if (state === 'playing') {
        container.classList.add('loaded');
        return;
      }
      text.textContent = 'Play video';
    };

    const renderFailed = (reason: Extract<TelegramVideoPlaybackState, 'failed-download' | 'failed-decode'>): void => {
      setTriggerState(reason);
    };

    const renderLoaded = (mediaUrl: string): void => {
      const video = document.createElement('video');
      video.className = className;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', label);
      const source = document.createElement('source');
      source.src = mediaUrl;
      if (message.videoMimeType && message.videoMimeType !== 'video/quicktime') {
        source.type = message.videoMimeType;
      }
      video.replaceChildren(source);
      video.load();

      let failed = false;
      let hasMetadata = false;

      const failDecode = (eventName: string): void => {
        if (failed) {
          return;
        }
        failed = true;
        const mediaUrlScheme = (() => {
          try {
            return new URL(mediaUrl).protocol;
          } catch {
            return 'unknown:';
          }
        })();
        console.warn('Telegram video playback failed.', {
          eventName,
          chatId,
          messageId: message.id,
          mimeType: message.videoMimeType,
          mediaUrlScheme,
          mediaErrorCode: video.error?.code,
          readyState: video.readyState,
          networkState: video.networkState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        if (!container.isConnected) {
          render();
          return;
        }
        container.replaceChildren(button);
        renderFailed('failed-decode');
      };

      video.addEventListener('loadedmetadata', () => {
        hasMetadata = true;
        if (video.videoWidth < 1 || video.videoHeight < 1) {
          failDecode('loadedmetadata');
        }
      });
      video.addEventListener('canplay', () => {
        if ((hasMetadata || video.readyState >= HTMLMediaElement.HAVE_METADATA) &&
          (video.videoWidth < 1 || video.videoHeight < 1)) {
          failDecode('canplay');
        }
      });
      video.addEventListener('error', () => {
        failDecode('error');
      });
      video.addEventListener('stalled', () => {
        if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          failDecode('stalled');
        }
      });
      video.addEventListener('abort', () => {
        if (playbackState === 'playing') {
          failDecode('abort');
        }
      });
      video.addEventListener('ended', () => {
        if (!failed) {
          playbackState = 'playing';
        }
      });

      setTriggerState('playing');
      container.replaceChildren(video);
      void video.play().catch(() => {
        // Leave controls visible if autoplay is blocked after explicit click.
      });
    };

    const existingUrl = message.videoUrl?.trim();
    if (existingUrl) {
      renderLoaded(existingUrl);
      return container;
    }

    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (playbackState === 'failed-decode') {
        const localPath = message.videoUrl ? extractLocalMediaPath(message.videoUrl) : undefined;
        if (!localPath) {
          renderFailed('failed-download');
          return;
        }
        const opened = await window.pelec.openPath(localPath);
        if (!opened) {
          console.warn('Failed to open Telegram video externally.', {
            chatId,
            messageId: message.id,
            localPath,
          });
        }
        return;
      }
      if (loading) {
        return;
      }
      if (!chatId) {
        renderFailed('failed-download');
        return;
      }

      loading = true;
      setTriggerState('loading');
      const resolved = await resolveTelegramVideoUrl(chatId, message.id);
      loading = false;

      if (chatId !== state.activeTelegramChatId) {
        return;
      }
      if (!resolved) {
        console.warn('Failed to resolve Telegram video URL.', {
          chatId,
          messageId: message.id,
        });
        if (!container.isConnected) {
          render();
          return;
        }
        renderFailed('failed-download');
        return;
      }

      message.videoUrl = resolved;
      if (!container.isConnected) {
        render();
        return;
      }
      renderLoaded(resolved);
    });

    return container;
  };

  const resetTelegramChatRenderCache = (): void => {
    renderedTelegramChatButtonById.clear();
    renderedTelegramChatSignatureById.clear();
    lastRenderedTelegramChatsVersion = -1;
    lastRenderedTelegramSearchQuery = '';
    lastRenderedTelegramActiveChatButtonId = null;
    lastRenderedTelegramSelectedChatId = null;
    lastRenderedTelegramChatPane = null;
  };

  const resetTelegramMessageRenderCache = (): void => {
    renderedTelegramMessageNodeById.clear();
    renderedTelegramMessageBundleById.clear();
    lastRenderedTelegramMessagesVersion = -1;
    lastRenderedTelegramSelectedMessageId = null;
    lastRenderedTelegramMessagePane = null;
  };

  const renderTelegramChatEmptyState = (markup: string): void => {
    telegramChatListEl.innerHTML = markup;
    resetTelegramChatRenderCache();
  };

  const syncTelegramChatListNodes = (filteredTelegramChats: ChatSummary[]): void => {
    const nextButtons: HTMLButtonElement[] = [];
    const nextIds = new Set(filteredTelegramChats.map((chat) => chat.id));

    for (const [chatId] of renderedTelegramChatButtonById.entries()) {
      if (nextIds.has(chatId)) {
        continue;
      }
      renderedTelegramChatButtonById.delete(chatId);
      renderedTelegramChatSignatureById.delete(chatId);
    }

    for (const chat of filteredTelegramChats) {
      const nextSignature = getTelegramChatRenderSignature(chat);
      const previousSignature = renderedTelegramChatSignatureById.get(chat.id);
      let button = renderedTelegramChatButtonById.get(chat.id);

      if (!button || previousSignature !== nextSignature) {
        button = createTelegramChatListItem(chat, {
          createAvatarNode,
          formatChatTimestamp,
          formatFullDateTime,
          formatTelegramUnreadBadge,
          hasValidTimestamp,
          onClick: () => {
            closeTelegramContextMenu(false);
            void selectTelegramChat(chat.id, {
              forceScroll: true,
              showLoadingState: true,
            });
          },
          safeLabel,
          safeText,
        });
        renderedTelegramChatButtonById.set(chat.id, button);
        renderedTelegramChatSignatureById.set(chat.id, nextSignature);
      }

      nextButtons.push(button);
    }

    telegramChatListEl.replaceChildren(...nextButtons);
  };

  const renderTelegramMessageEmptyState = (markup: string): void => {
    telegramMessageLegacyRootEl.innerHTML = markup;
    resetTelegramMessageRenderCache();
    lastRenderedTelegramChatId = state.activeTelegramChatId;
  };

  const syncTelegramChatListSelection = (): void => {
    if (lastRenderedTelegramActiveChatButtonId !== state.activeTelegramChatId) {
      if (lastRenderedTelegramActiveChatButtonId) {
        renderedTelegramChatButtonById.get(lastRenderedTelegramActiveChatButtonId)?.classList.remove('active');
      }
      if (state.activeTelegramChatId) {
        renderedTelegramChatButtonById.get(state.activeTelegramChatId)?.classList.add('active');
      }
      lastRenderedTelegramActiveChatButtonId = state.activeTelegramChatId;
    }

    const nextSelectedChatId =
      state.vimPane === 'telegram-chats' ? state.selectedTelegramChatId : null;
    if (
      lastRenderedTelegramSelectedChatId !== nextSelectedChatId ||
      lastRenderedTelegramChatPane !== state.vimPane
    ) {
      if (lastRenderedTelegramSelectedChatId) {
        renderedTelegramChatButtonById.get(lastRenderedTelegramSelectedChatId)?.classList.remove('selected');
      }
      if (nextSelectedChatId) {
        renderedTelegramChatButtonById.get(nextSelectedChatId)?.classList.add('selected');
      }
      lastRenderedTelegramSelectedChatId = nextSelectedChatId;
      lastRenderedTelegramChatPane = state.vimPane;
    }

    if (nextSelectedChatId) {
      renderedTelegramChatButtonById.get(nextSelectedChatId)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const syncTelegramMessageSelection = (): void => {
    if (useReactTelegramMessageList) {
      lastRenderedTelegramSelectedMessageId =
        state.vimPane === 'telegram-messages' ? state.selectedTelegramMessageId : null;
      lastRenderedTelegramMessagePane = state.vimPane;
      return;
    }

    const nextSelectedMessageId =
      state.vimPane === 'telegram-messages' ? state.selectedTelegramMessageId : null;
    if (
      lastRenderedTelegramSelectedMessageId !== nextSelectedMessageId ||
      lastRenderedTelegramMessagePane !== state.vimPane
    ) {
      if (lastRenderedTelegramSelectedMessageId) {
        renderedTelegramMessageNodeById.get(lastRenderedTelegramSelectedMessageId)?.classList.remove('selected');
      }
      if (nextSelectedMessageId) {
        renderedTelegramMessageNodeById.get(nextSelectedMessageId)?.classList.add('selected');
      }
      lastRenderedTelegramSelectedMessageId = nextSelectedMessageId;
      lastRenderedTelegramMessagePane = state.vimPane;
    }

    if (nextSelectedMessageId && !telegramContextMenuState.visible) {
      renderedTelegramMessageNodeById.get(nextSelectedMessageId)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const renderTelegramNative = (): void => {
    if (state.activeNetwork !== 'telegram') {
      nativeTelegram.classList.add('hidden');
      return;
    }

    nativeTelegram.classList.remove('hidden');
    nativeTelegram.classList.toggle(
      'telegram-chat-list-minimized',
      state.telegramChatListMinimized,
    );

    const telegramStatus = getStatusByNetwork('telegram');
    const canSendToActiveChat = activeTelegramChatCanSend();

    if (telegramStatus.authState !== 'authenticated') {
      telegramComposerEl.style.display = 'none';
      renderTelegramChatEmptyState('<div class="telegram-empty">Telegram is not authenticated yet. Click Start Auth.</div>');
      renderTelegramMessageEmptyState(`<div class="telegram-empty">${telegramStatus.details}</div>`);
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }

    telegramComposerEl.style.display = canSendToActiveChat ? 'grid' : 'none';

    if (useReactTelegramMessageList) {
      const activeChatChanged = lastRenderedTelegramChatId !== state.activeTelegramChatId;
      const activeChat = state.telegramChats.find((chat) => chat.id === state.activeTelegramChatId);
      telegramChatTitleEl.textContent = safeLabel(activeChat?.title, 'Telegram');
      telegramMessageLegacyRootEl.replaceChildren();
      lastRenderedTelegramChatId = state.activeTelegramChatId;
      lastRenderedTelegramChatsVersion = telegramChatsVersion;
      lastRenderedTelegramMessagesVersion = telegramMessagesVersion;
      lastRenderedTelegramSearchQuery = state.telegramSearchQuery;
      lastRenderedTelegramActiveChatButtonId = state.activeTelegramChatId;
      lastRenderedTelegramSelectedChatId =
        state.vimPane === 'telegram-chats' ? state.selectedTelegramChatId : null;
      lastRenderedTelegramChatPane = state.vimPane;
      lastRenderedTelegramSelectedMessageId =
        state.vimPane === 'telegram-messages' ? state.selectedTelegramMessageId : null;
      lastRenderedTelegramMessagePane = state.vimPane;
      if (activeChatChanged || telegramForceScrollBottom) {
        scheduleTelegramScrollToBottom();
        telegramForceScrollBottom = false;
      }
      return;
    }

    if (state.telegramLoading && state.telegramChats.length < 1) {
      renderTelegramChatEmptyState('<div class="telegram-empty">Loading chats...</div>');
      renderTelegramMessageEmptyState('<div class="telegram-empty">Loading messages...</div>');
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }

    if (state.telegramLoadError && state.telegramChats.length < 1) {
      renderTelegramChatEmptyState(
        `<div class="telegram-empty">${safeLabel(state.telegramLoadError, 'Failed to load Telegram chats.')}</div>`,
      );
      renderTelegramMessageEmptyState('<div class="telegram-empty">No messages to display.</div>');
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }

    if (state.telegramChats.length < 1) {
      renderTelegramChatEmptyState('<div class="telegram-empty">No chats yet.</div>');
      renderTelegramMessageEmptyState('<div class="telegram-empty">No messages to display.</div>');
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }
    try {
      if (!state.selectedTelegramChatId) {
        state.selectedTelegramChatId = state.telegramChats[0].id;
      }

      const filteredTelegramChats = filterChatsByQuery(
        state.telegramChats,
        state.telegramSearchQuery,
      );

      if (filteredTelegramChats.length < 1) {
        renderTelegramChatEmptyState('<div class="telegram-empty">No chats match your search.</div>');
      } else {
        const shouldRebuildChatList =
          lastRenderedTelegramChatsVersion !== telegramChatsVersion ||
          lastRenderedTelegramSearchQuery !== state.telegramSearchQuery ||
          renderedTelegramChatButtonById.size !== filteredTelegramChats.length;

        if (shouldRebuildChatList) {
          syncTelegramChatListNodes(filteredTelegramChats);
          lastRenderedTelegramChatsVersion = telegramChatsVersion;
          lastRenderedTelegramSearchQuery = state.telegramSearchQuery;
          lastRenderedTelegramActiveChatButtonId = null;
          lastRenderedTelegramSelectedChatId = null;
          lastRenderedTelegramChatPane = null;
        }

        syncTelegramChatListSelection();
      }

      const activeChat = state.telegramChats.find((chat) => chat.id === state.activeTelegramChatId);
      telegramChatTitleEl.textContent = safeLabel(activeChat?.title, 'Telegram');

      if (useReactTelegramMessageList) {
        const wasNearBottom =
          telegramMessageListEl.scrollHeight - telegramMessageListEl.scrollTop - telegramMessageListEl.clientHeight < 84;
        const activeChatChanged = lastRenderedTelegramChatId !== state.activeTelegramChatId;
        telegramMessageLegacyRootEl.replaceChildren();
        lastRenderedTelegramMessagesVersion = telegramMessagesVersion;
        lastRenderedTelegramSelectedMessageId =
          state.vimPane === 'telegram-messages' ? state.selectedTelegramMessageId : null;
        lastRenderedTelegramMessagePane = state.vimPane;
        if (
          activeChatChanged ||
          telegramForceScrollBottom ||
          (wasNearBottom && state.vimPane !== 'telegram-messages')
        ) {
          scheduleTelegramScrollToBottom();
          telegramForceScrollBottom = false;
        }
        lastRenderedTelegramChatId = state.activeTelegramChatId;
        return;
      }

      if (state.telegramMessagesLoading) {
        renderTelegramMessageEmptyState('<div class="telegram-empty">Loading messages...</div>');
      } else if (state.telegramLoadError) {
        renderTelegramMessageEmptyState(
          `<div class="telegram-empty">${safeLabel(state.telegramLoadError, 'Failed to load Telegram messages.')}</div>`,
        );
      } else if (getVisibleTelegramMessages().length < 1) {
        renderTelegramMessageEmptyState('<div class="telegram-empty">No messages in this chat.</div>');
      } else {
        const wasNearBottom =
          telegramMessageListEl.scrollHeight - telegramMessageListEl.scrollTop - telegramMessageListEl.clientHeight < 84;
        const activeChatChanged = lastRenderedTelegramChatId !== state.activeTelegramChatId;
        const renderChatId = state.activeTelegramChatId;
        const visibleTelegramMessages = getVisibleTelegramMessages();
        const shouldRebuildMessages =
          activeChatChanged || lastRenderedTelegramMessagesVersion !== telegramMessagesVersion;

        if (shouldRebuildMessages) {
          const endRenderMeasure = beginMeasure('telegram.messages.render');
          if (activeChatChanged) {
            renderedTelegramMessageNodeById.clear();
            renderedTelegramMessageBundleById.clear();
          }
          const messageNodes: HTMLElement[] = [];
          const nextRenderedMessageIds = new Set<string>();
          for (let index = 0; index < visibleTelegramMessages.length; index += 1) {
            const message = visibleTelegramMessages[index];
            if (!message) {
              continue;
            }
            const albumMessages = [message];
            if (isTelegramAlbumEligibleMessage(message)) {
              for (let nextIndex = index + 1; nextIndex < visibleTelegramMessages.length; nextIndex += 1) {
                const nextMessage = visibleTelegramMessages[nextIndex];
                if (
                  !nextMessage ||
                  nextMessage.mediaAlbumId !== message.mediaAlbumId ||
                  !isTelegramAlbumEligibleMessage(nextMessage)
                ) {
                  break;
                }
                albumMessages.push(nextMessage);
              }
            }

            const meaningfulAlbumCaptions = [...new Set(
              albumMessages
                .map((albumMessage) => getTelegramMeaningfulAlbumCaption(albumMessage))
                .filter((value): value is string => !!value),
            )];
            const albumDisplayCaption = meaningfulAlbumCaptions[0] ?? '';
            const shouldCollapseAlbum = albumMessages.length > 1 && meaningfulAlbumCaptions.length <= 1;
            const renderMessages = shouldCollapseAlbum ? albumMessages : [message];

            const primaryMessage = renderMessages[renderMessages.length - 1] ?? message;
            const previousMessage = index > 0 ? visibleTelegramMessages[index - 1] : null;
            const bundleSignature = getTelegramMessageRenderSignature({
              albumCaption: albumDisplayCaption,
              previousMessage,
              primaryMessage,
              renderMessages,
              shouldCollapseAlbum,
            });
            const cachedBundle = renderedTelegramMessageBundleById.get(primaryMessage.id);
            nextRenderedMessageIds.add(primaryMessage.id);

            if (cachedBundle && cachedBundle.signature === bundleSignature) {
              renderedTelegramMessageNodeById.set(
                primaryMessage.id,
                cachedBundle.nodes[cachedBundle.nodes.length - 1] as HTMLElement,
              );
              messageNodes.push(...cachedBundle.nodes);
              index += renderMessages.length - 1;
              continue;
            }

            const nodes: HTMLElement[] = [];
            const messageId = safeLabel(primaryMessage.id, String(index));
            const messageTextValue = shouldCollapseAlbum
              ? albumDisplayCaption
              : safeText(primaryMessage.text);
            const messageTextTrimmed = messageTextValue.trim();
            const messageTextLower = messageTextTrimmed.toLowerCase();
            const senderLabel = safeLabel(primaryMessage.sender, primaryMessage.outgoing ? 'You' : 'Unknown');
            if (
              hasValidTimestamp(primaryMessage.timestamp) &&
              (!previousMessage ||
                !hasValidTimestamp(previousMessage.timestamp) ||
                formatMessageDayLabel(previousMessage.timestamp) !== formatMessageDayLabel(primaryMessage.timestamp))
            ) {
              const dayDivider = document.createElement('div');
              dayDivider.className = 'telegram-message-day-divider';
              dayDivider.textContent = formatMessageDayLabel(primaryMessage.timestamp);
              dayDivider.title = formatFullDateTime(primaryMessage.timestamp);
              nodes.push(dayDivider);
            }

            const item = document.createElement('article');
            item.className = 'telegram-message-item';
            item.classList.add(primaryMessage.outgoing ? 'outgoing' : 'incoming');
            if (shouldCollapseAlbum) {
              item.classList.add('album');
            }
            const isContinuation =
              !!previousMessage &&
              safeText(previousMessage.sender) === safeText(primaryMessage.sender) &&
              previousMessage.outgoing === primaryMessage.outgoing;
            if (isContinuation) {
              item.classList.add('continuation');
            }

            const header = document.createElement('div');
            header.className = 'telegram-message-header';
            const avatar = createAvatarNode(senderLabel, primaryMessage.senderAvatarUrl, 'telegram-avatar small');
            const meta = document.createElement('div');
            meta.className = 'telegram-message-meta';
            meta.textContent = primaryMessage.outgoing ? 'You' : senderLabel;
            const text = document.createElement('div');
            text.className = 'telegram-message-text';
            text.replaceChildren(
              ...buildLinkedTextNodes(
                messageTextTrimmed || '[empty]',
                !shouldCollapseAlbum && messageTextTrimmed === safeText(primaryMessage.text).trim()
                  ? primaryMessage.textEntities
                  : undefined,
              ),
            );
            if (primaryMessage.outgoing) {
              header.replaceChildren(meta);
            } else {
              header.replaceChildren(avatar, meta);
            }

            const bodyNodes: HTMLElement[] = [];
            if (!isContinuation) {
              bodyNodes.push(header);
            }
            if (primaryMessage.forwardedFrom) {
              const forwarded = document.createElement('div');
              forwarded.className = 'telegram-message-forwarded';
              forwarded.textContent = `Forwarded from ${safeLabel(primaryMessage.forwardedFrom, 'Unknown')}`;
              bodyNodes.push(forwarded);
            }
            if (primaryMessage.replyToSender || primaryMessage.replyToText) {
              const reply = document.createElement('div');
              reply.className = 'telegram-message-reply';
              const replySender = document.createElement('div');
              replySender.className = 'telegram-message-reply-sender';
              replySender.textContent = safeLabel(primaryMessage.replyToSender, 'Reply');
              const replyText = document.createElement('div');
              replyText.className = 'telegram-message-reply-text';
              replyText.textContent = safeText(primaryMessage.replyToText).trim() || '[message]';
              reply.replaceChildren(replySender, replyText);
              bodyNodes.push(reply);
            }
            if (primaryMessage.call) {
              bodyNodes.push(createTelegramCallCard(primaryMessage));
            }
            if (shouldCollapseAlbum) {
              const album = document.createElement('div');
              album.className = `telegram-message-album album-size-${Math.min(renderMessages.length, 6)}`;
              album.replaceChildren(
                ...renderMessages.map((albumMessage) => {
                  if (albumMessage.videoUrl || albumMessage.hasVideo) {
                    const albumItem = document.createElement('div');
                    albumItem.className = 'telegram-message-album-item is-video';
                    albumItem.append(
                      createTelegramVideoShell(
                        albumMessage,
                        renderChatId ?? '',
                        'telegram-message-album-video',
                        'Telegram video',
                        true,
                      ),
                    );
                    return albumItem;
                  }

                  const albumItem = document.createElement('button');
                  albumItem.type = 'button';
                  albumItem.className = 'telegram-message-album-item';
                  if (albumMessage.videoUrl) {
                    albumItem.classList.add('is-video');
                  } else if (albumMessage.imageUrl) {
                    const image = document.createElement('img');
                    image.className = 'telegram-message-album-image';
                    image.src = albumMessage.imageUrl;
                    image.alt = 'Telegram image';
                    image.loading = 'lazy';
                    albumItem.append(image);
                  }
                  albumItem.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (albumMessage.imageUrl) {
                      openTelegramImagePreview(albumMessage.imageUrl);
                    }
                  });
                  return albumItem;
                }),
              );
              bodyNodes.push(album);
            } else if (primaryMessage.imageUrl) {
              const image = document.createElement('img');
              image.className = 'telegram-message-image';
              image.src = primaryMessage.imageUrl;
              image.alt = 'Telegram image';
              image.loading = 'lazy';
              image.addEventListener('click', () => {
                openTelegramImagePreview(primaryMessage.imageUrl as string);
              });
              bodyNodes.push(image);
            } else if (primaryMessage.videoUrl || primaryMessage.hasVideo) {
              bodyNodes.push(
                createTelegramVideoShell(
                  primaryMessage,
                  renderChatId ?? '',
                  'telegram-message-video',
                  'Telegram video',
                ),
              );
            }
            if (primaryMessage.animationUrl) {
              bodyNodes.push(
                createAnimatedMediaNode(
                  primaryMessage.animationUrl,
                  primaryMessage.animationMimeType,
                  'telegram-message-animation',
                  'Telegram animation',
                ),
              );
            }
            if (primaryMessage.stickerUrl) {
              const sticker = document.createElement('img');
              sticker.className = 'telegram-message-sticker';
              sticker.src = primaryMessage.stickerUrl;
              sticker.alt = primaryMessage.stickerEmoji
                ? `Telegram sticker ${primaryMessage.stickerEmoji}`
                : 'Telegram sticker';
              sticker.loading = 'lazy';
              if (primaryMessage.stickerIsAnimated) {
                sticker.title = 'Animated sticker preview';
              }
              bodyNodes.push(sticker);
            }
            if (primaryMessage.hasAudio || primaryMessage.audioUrl) {
              bodyNodes.push(
                ...createTelegramVoiceNoteNodes({
                  buildVoiceBarHeights,
                  formatDuration,
                  message: primaryMessage,
                  messageId,
                  renderChatId,
                  resolveTelegramAudioUrl,
                }),
              );
            }
            if (primaryMessage.document) {
              bodyNodes.push(
                createTelegramDocumentCard({
                  chatId: renderChatId,
                  copyTelegramDocument,
                  downloadTelegramDocument,
                  formatTelegramDocumentKind,
                  formatTelegramDocumentSubtitle,
                  message: primaryMessage,
                  safeLabel,
                }),
              );
            }

            const suppressImageFallbackText =
              !shouldCollapseAlbum &&
              !!primaryMessage.imageUrl &&
              isTelegramImageFallbackText(primaryMessage);
            const suppressVideoFallbackText =
              !shouldCollapseAlbum &&
              !!(primaryMessage.videoUrl || primaryMessage.hasVideo) &&
              isTelegramVideoFallbackText(primaryMessage);
            const suppressDocumentFallbackText =
              !shouldCollapseAlbum && isTelegramDocumentFallbackText(primaryMessage);
            const shouldRenderText =
              !!messageTextTrimmed &&
              !primaryMessage.call &&
              !suppressImageFallbackText &&
              !suppressVideoFallbackText &&
              !(primaryMessage.animationUrl && messageTextLower === 'gif/animation') &&
              !(
                primaryMessage.stickerUrl &&
                (messageTextLower === 'sticker' || messageTextLower.startsWith('sticker '))
              ) &&
              !((primaryMessage.audioUrl || primaryMessage.hasAudio) && messageTextLower === 'voice message') &&
              !suppressDocumentFallbackText;
            const isDocumentOnlyMessage =
              !!primaryMessage.document &&
              !shouldRenderText &&
              !primaryMessage.call &&
              !primaryMessage.imageUrl &&
              !primaryMessage.videoUrl &&
              !primaryMessage.hasVideo &&
              !primaryMessage.animationUrl &&
              !primaryMessage.stickerUrl &&
              !(primaryMessage.audioUrl || primaryMessage.hasAudio);
            if (isDocumentOnlyMessage) {
              item.classList.add('document-only');
            }
            if (shouldRenderText) {
              bodyNodes.push(text);
            }

            const reactions = createTelegramMessageReactions(primaryMessage, safeLabel);
            if (reactions) {
              bodyNodes.push(reactions);
            }

            bodyNodes.push(
              createTelegramMessageFooter({
                formatFullDateTime,
                formatMessageTimestamp,
                hasValidTimestamp,
                isPendingTelegramMessage,
                message: primaryMessage,
              }),
            );

            item.replaceChildren(...bodyNodes);
            item.addEventListener('click', () => {
              if (isTelegramContextMenuGuardActive()) {
                return;
              }
              closeTelegramContextMenu(false);
              selectTelegramMessage(primaryMessage.id);
              render();
            });
            item.addEventListener('pointerdown', (event) => {
              if (isSecondaryTelegramPointerEvent(event)) {
                event.preventDefault();
                event.stopPropagation();
                openTelegramContextMenu(primaryMessage.id, event.clientX, event.clientY);
                return;
              }
              if (telegramContextMenuState.visible) {
                closeTelegramContextMenu(false);
              }
            });
            item.addEventListener('contextmenu', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!telegramContextMenuState.visible || telegramContextMenuState.messageId !== primaryMessage.id) {
                openTelegramContextMenu(primaryMessage.id, event.clientX, event.clientY);
              }
            });
            renderedTelegramMessageNodeById.set(primaryMessage.id, item);
            const nextBundleNodes = [...nodes, item];
            renderedTelegramMessageBundleById.set(primaryMessage.id, {
              nodes: nextBundleNodes,
              signature: bundleSignature,
            });
            messageNodes.push(...nextBundleNodes);
            index += renderMessages.length - 1;
          }
          for (const messageId of [...renderedTelegramMessageBundleById.keys()]) {
            if (nextRenderedMessageIds.has(messageId)) {
              continue;
            }
            renderedTelegramMessageBundleById.delete(messageId);
            renderedTelegramMessageNodeById.delete(messageId);
          }
          syncTelegramMessageListNodes(telegramMessageLegacyRootEl, messageNodes);
          lastRenderedTelegramMessagesVersion = telegramMessagesVersion;
          lastRenderedTelegramSelectedMessageId = null;
          lastRenderedTelegramMessagePane = null;
          endRenderMeasure();
          if (
            activeChatChanged ||
            telegramForceScrollBottom ||
            (wasNearBottom && state.vimPane !== 'telegram-messages')
          ) {
            scheduleTelegramScrollToBottom();
            telegramForceScrollBottom = false;
          }
        }

        syncTelegramMessageSelection();
        if (!shouldRebuildMessages && telegramForceScrollBottom) {
          scheduleTelegramScrollToBottom();
          telegramForceScrollBottom = false;
        }
      }
    } catch (error) {
      console.error('Telegram render failed.', error);
      telegramChatTitleEl.textContent = 'Telegram';
      if (telegramChatListEl.childElementCount < 1) {
        renderTelegramChatEmptyState('<div class="telegram-empty">Telegram chats are unavailable.</div>');
      }
      renderTelegramMessageEmptyState(
        '<div class="telegram-empty">This chat could not be rendered. Try refreshing Telegram.</div>',
      );
    }
    if (state.pendingTelegramAttachments.length > 0) {
      const thumbs = state.pendingTelegramAttachments.map((attachment, index) => {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'telegram-compose-thumb-wrap';
        const preview =
          attachment.kind === 'image'
            ? document.createElement('img')
            : document.createElement('div');
        preview.className =
          attachment.kind === 'image'
            ? 'telegram-compose-preview'
            : 'telegram-compose-document';
        if (attachment.kind === 'image') {
          (preview as HTMLImageElement).src = attachment.dataUrl;
          (preview as HTMLImageElement).alt = attachment.name || `Pasted image ${index + 1}`;
        } else {
          const nameEl = document.createElement('div');
          nameEl.className = 'telegram-compose-document-name';
          nameEl.textContent = attachment.name;
          const metaEl = document.createElement('div');
          metaEl.className = 'telegram-compose-document-meta';
          metaEl.textContent = formatTelegramAttachmentMeta(attachment);
          preview.replaceChildren(nameEl, metaEl);
        }
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'telegram-compose-thumb-remove';
        clearButton.textContent = '×';
        clearButton.addEventListener('click', () => {
          state.pendingTelegramAttachments = state.pendingTelegramAttachments.filter(
            (item) => item.id !== attachment.id,
          );
          render();
        });
        thumbWrap.replaceChildren(preview, clearButton);
        return thumbWrap;
      });

      telegramComposeAttachment.replaceChildren(...thumbs);
      telegramComposeAttachment.classList.remove('hidden');
    } else {
      telegramComposeAttachment.replaceChildren();
      telegramComposeAttachment.classList.add('hidden');
    }

    const replyPreview = getTelegramReplyPreview();
    if (replyPreview) {
      telegramComposeReplySenderEl.textContent = replyPreview.sender;
      telegramComposeReplyTextEl.textContent = replyPreview.text;
      telegramComposeReplyEl.classList.remove('hidden');
    } else {
      telegramComposeReplySenderEl.textContent = '';
      telegramComposeReplyTextEl.textContent = '';
      telegramComposeReplyEl.classList.add('hidden');
    }

    telegramComposeInput.placeholder = state.replyingToMessageId
      ? `Reply to ${state.replyingToSender ?? 'message'}`
      : state.pendingTelegramAttachments.length > 0
        ? 'Type a caption...'
        : 'Type your message here...';
    syncTelegramComposeInputHeight();
    renderTelegramEmojiCompletion();
    lastRenderedTelegramChatId = state.activeTelegramChatId;
  };

  const renderInstagramWeb = (): void => {
    if (!instagramWebShell) {
      return;
    }

    if (state.activeNetwork !== 'instagram' || !instagramEnabled) {
      instagramWebShell.classList.add('hidden');
      return;
    }

    instagramWebShell.classList.remove('hidden');
  };

  const render = (): void => {
    const networks = visibleNetworks();

    if (!networks.some((network) => network.id === state.selectedNetwork)) {
      state.selectedNetwork = networks[0]?.id ?? state.selectedNetwork;
    }

    shellEl.classList.remove('telegram-focus');
    shellEl.classList.add('sidebar-collapsed');
    shellEl.classList.toggle('network-rail-hidden', !NETWORK_RAIL_VISIBLE);

    networkList.replaceChildren(
      ...networks.map((network) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'network-item';
        if (network.id === state.selectedNetwork) {
          item.classList.add('selected');
        }
        if (network.id === state.activeNetwork) {
          item.classList.add('active');
        }

        const loading = state.loading[network.id] ? 'loading' : 'ready';
        if (state.sidebarCollapsed) {
          const shortLabel = network.name.slice(0, 2).toUpperCase();
          item.innerHTML = `<span class="network-short">${shortLabel}</span>`;
          item.title = `${network.name} • ${buildStatusText(network.id)}`;
        } else {
          item.innerHTML = `<span>${network.name}</span><span class="network-meta">${loading} • ${buildStatusText(network.id)}</span>`;
          item.removeAttribute('title');
        }

        item.addEventListener('click', () => {
          state.selectedNetwork = network.id;
          activateNetwork(network.id);
        });

        return item;
      }),
    );
    networkList
      .querySelector<HTMLElement>('.network-item.selected')
      ?.scrollIntoView({ block: 'nearest' });

    for (const [id, webview] of webviewMap.entries()) {
      const hiddenForNativeView = id === 'telegram';
      const isActiveWebview = id === state.activeNetwork && !hiddenForNativeView;
      const shouldAllowWebviewInteraction = state.mode === 'insert' && isActiveWebview;
      webview.classList.toggle('active', id === state.activeNetwork && !hiddenForNativeView);
      webview.style.display = isActiveWebview ? 'block' : 'none';
      webview.style.pointerEvents = shouldAllowWebviewInteraction ? 'auto' : 'none';
      webview.style.visibility = isActiveWebview ? 'visible' : 'hidden';
      if (!shouldAllowWebviewInteraction) {
        webview.blur?.();
      }
    }

    if (
      state.activeNetwork === 'telegram' &&
      state.mode !== 'insert' &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.tagName === 'WEBVIEW'
    ) {
      scheduleTelegramKeyboardSurfaceFocus();
    }

    renderTelegramNative();
    renderInstagramWeb();

    renderCurrentStatusBar();

    commandPalette.classList.toggle('hidden', !state.commandPaletteOpen);
    renderCommandPalette();
    emitSnapshotChange();
  };

  const syncTelegramComposeInputHeight = (): void => {
    telegramComposeInput.style.height = '0px';
    telegramComposeInput.style.height = `${telegramComposeInput.scrollHeight}px`;
  };

  updateTelegramVoiceRecorderUi();

  telegramSendButton.addEventListener('click', () => {
    void sendTelegramMessage();
  });

  telegramComposeReplyCloseEl.addEventListener('click', () => {
    clearTelegramReplyState();
    statusBar.textContent = 'Reply canceled.';
    render();
    telegramComposeInput.focus();
  });

  telegramAttachButton.addEventListener('click', () => {
    telegramAttachInput.click();
  });

  telegramAttachInput.addEventListener('change', () => {
    const files = telegramAttachInput.files ? Array.from(telegramAttachInput.files) : [];
    telegramAttachInput.value = '';
    if (files.length < 1) {
      return;
    }
    void appendTelegramFiles(files, 'selected');
  });

  telegramVoiceRecordButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (telegramVoiceRecorder) {
      stopTelegramVoiceRecording();
      return;
    }
    void startTelegramVoiceRecording();
  });

  telegramVoiceRecordButton.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('blur', () => {
    cancelTelegramVoiceRecording();
  });

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === telegramComposeInput) {
      updateTelegramEmojiCompletion();
    }
  });

  telegramComposeInput.addEventListener('input', () => {
    syncTelegramComposeInputHeight();
    updateTelegramEmojiCompletion();
  });

  telegramComposeInput.addEventListener('focus', () => {
    updateTelegramEmojiCompletion();
  });

  telegramComposeInput.addEventListener('blur', () => {
    closeTelegramEmojiCompletion();
  });

  telegramComposeInput.addEventListener('keydown', (event) => {
    if (telegramEmojiCompletionState.visible) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveTelegramEmojiCompletion(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveTelegramEmojiCompletion(-1);
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        insertTelegramEmojiCompletion();
        return;
      }
    }

    if (event.key === 'Enter') {
      const sendBehavior = appConfig.userConfig.keyboard.sendBehavior;
      const modPressed = event.ctrlKey || event.metaKey;
      const shouldSend =
        (sendBehavior === 'enter' && !event.shiftKey) ||
        (sendBehavior === 'mod-enter' && modPressed);

      if (modPressed || shouldSend) {
        event.preventDefault();
        void sendTelegramMessage();
        return;
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (telegramEmojiCompletionState.visible) {
        closeTelegramEmojiCompletion();
        return;
      }
      if (state.replyingToMessageId) {
        clearTelegramReplyState();
        statusBar.textContent = 'Reply canceled.';
        render();
        return;
      }
      setMode('normal');
    }
  });

  telegramComposeInput.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items;
    if (!items || items.length < 1) {
      return;
    }
    const files = Array.from(items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (files.length < 1) {
      return;
    }
    event.preventDefault();
    void appendTelegramFiles(files, 'pasted');
  });

  quickFilter.addEventListener('input', () => render());

  telegramSearchInput.addEventListener('input', () => {
    setTelegramSearchQuery(telegramSearchInput.value);
  });

  commandInput.addEventListener('input', () => {
    state.commandQuery = commandInput.value;
    render();
  });

  commandInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      executeCommandByQuery();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      state.commandPaletteOpen = false;
      state.commandQuery = '';
      commandInput.value = '';
      setMode('normal');
    }
  });

  syncTelegramComposeInputHeight();

  window.pelec.onForceNormalMode(() => {
    setMode('normal');
  });

  window.pelec.onActivateNetwork((network) => {
    state.commandPaletteOpen = false;
    state.commandQuery = '';
    commandInput.value = '';
    clearGPending();
    setMode('normal');
    activateNetwork(network);
  });

  window.pelec.onAppActivity((activity) => {
    setStatusActivity(activity);
    render();
  });

  window.pelec.onConnectorUpdate((event: ConnectorUpdateEvent) => {
    if (event.network === 'telegram') {
      if (event.kind === 'status-changed') {
        void refreshConnectorStatuses().then(async () => {
          const telegramStatus = getStatusByNetwork('telegram');
          if (
            telegramStatus.mode === 'native' &&
            telegramStatus.authState === 'authenticated' &&
            state.activeNetwork === 'telegram'
          ) {
            await loadTelegramChats();
          } else {
            render();
          }
        });
        return;
      }

      if (event.kind === 'chat-list-invalidated') {
        const changedChatId = event.changedChatIds?.[0];
        if (
          state.activeNetwork === 'telegram' &&
          changedChatId &&
          state.activeTelegramChatId === changedChatId
        ) {
          scheduleTelegramMessagesRefresh(changedChatId);
        }
        scheduleTelegramChatsRefresh(300, false);
        return;
      }

      if (event.kind === 'messages-invalidated') {
        if (event.chatId && state.activeTelegramChatId && event.chatId !== state.activeTelegramChatId) {
          scheduleTelegramChatsRefresh(300, false);
          return;
        }
        if (state.activeNetwork === 'telegram' && state.activeTelegramChatId) {
          scheduleTelegramMessagesRefresh(state.activeTelegramChatId);
        }
        scheduleTelegramChatsRefresh(300, false);
      }
      return;
    }

    if (event.network === 'instagram') {
      if (event.kind === 'status-changed') {
        void refreshConnectorStatuses().then(() => {
          render();
        });
        return;
      }

      if (event.kind === 'chat-list-invalidated') {
        scheduleInstagramChatsRefresh();
        if (state.activeNetwork === 'instagram') {
          render();
        }
        return;
      }

      if (event.kind === 'messages-invalidated') {
        if (state.activeNetwork === 'instagram' && event.chatId === state.activeInstagramChatId) {
          scheduleInstagramMessagesRefresh(event.chatId);
        }
        scheduleInstagramChatsRefresh();
        if (state.activeNetwork === 'instagram') {
          render();
        }
      }
    }
  });

  let gPending = false;
  let gPendingTimer: number | null = null;

  const clearGPending = (): void => {
    gPending = false;
    if (gPendingTimer !== null) {
      window.clearTimeout(gPendingTimer);
      gPendingTimer = null;
    }
  };

  if (!options.disableDefaultKeyboardHandling) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && authPromptState) {
        event.preventDefault();
        cancelAuthPrompt();
        return;
      }

      if (event.key === 'Escape' && qrAuthState) {
        event.preventDefault();
        hideQrModal();
        return;
      }

      if (event.key === 'Escape' && activeTelegramImageUrl) {
        event.preventDefault();
        closeTelegramImagePreview();
        return;
      }

      if (event.key === 'Escape' && telegramForwardState.visible) {
        event.preventDefault();
        if (!telegramForwardState.sending) {
          closeTelegramForwardMenu();
        }
        return;
      }

      if (telegramForwardState.visible) {
        return;
      }

      if (event.key === 'Escape' && telegramContextMenuState.visible) {
        event.preventDefault();
        closeTelegramContextMenu();
        return;
      }

      if (state.activeNetwork === 'telegram' && event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        clearGPending();
        toggleTelegramChatListMinimized();
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isTypingTarget && event.key !== 'Escape') {
        return;
      }

      if (state.commandPaletteOpen && event.key !== 'Escape') {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        clearGPending();
        state.commandPaletteOpen = false;
        state.commandQuery = '';
        commandInput.value = '';
        setMode('normal');
        return;
      }

      if (state.mode === 'insert') {
        return;
      }

      if (event.key === '/' && document.activeElement !== quickFilter) {
        if (!NETWORK_RAIL_VISIBLE) {
          return;
        }
        event.preventDefault();
        quickFilter.focus();
        quickFilter.select();
        return;
      }

      if (event.key === ':') {
        clearGPending();
        event.preventDefault();
        state.commandPaletteOpen = true;
        commandInput.focus();
        render();
        return;
      }

      if (event.key === 'j') {
        clearGPending();
        event.preventDefault();
        moveVimSelection(1);
        return;
      }

    if (event.key === 'k') {
      clearGPending();
      event.preventDefault();
      moveVimSelection(-1);
      return;
    }

    if (event.key === 'h') {
      clearGPending();
      event.preventDefault();
      moveVimPane(-1);
      return;
    }

    if (event.key === 'l') {
      clearGPending();
      event.preventDefault();
      moveVimPane(1);
      return;
    }

    if (event.key === 'g') {
      event.preventDefault();
      if (gPending) {
        clearGPending();
        moveSelectionToEdge('first');
        return;
      }
      gPending = true;
      gPendingTimer = window.setTimeout(() => {
        clearGPending();
      }, 420);
      return;
    }

    if (event.key === 'G') {
      clearGPending();
      event.preventDefault();
      moveSelectionToEdge('last');
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'u') {
      clearGPending();
      event.preventDefault();
      moveSelectionByPage(-1);
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      clearGPending();
      event.preventDefault();
      moveSelectionByPage(1);
      return;
    }

    if (event.key === 'Enter') {
      clearGPending();
      event.preventDefault();
      activateVimSelection();
      return;
    }

    if (event.key === 'i') {
      clearGPending();
      event.preventDefault();
      setMode('insert');
      return;
    }

    if (event.key === 'r') {
      clearGPending();
      event.preventDefault();
      if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
        beginReplyToSelectedTelegramMessage();
      } else if (state.activeNetwork === 'telegram') {
        void loadTelegramChats();
      } else {
        const activeWebview = webviewMap.get(state.activeNetwork);
        activeWebview?.reload();
      }
      return;
    }

    if (event.key === 'd') {
      clearGPending();
      if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
        event.preventDefault();
        void deleteSelectedTelegramMessage();
      }
      return;
    }

    if (event.key === 'a') {
      clearGPending();
      event.preventDefault();
      void startAuthForNetwork(state.activeNetwork);
      return;
    }

    if (event.key === 'o') {
      clearGPending();
      event.preventDefault();
      const active = getStatusByNetwork(state.activeNetwork);
      if (active.webUrl !== 'about:blank') {
        void window.pelec.openExternal(active.webUrl);
      }
    }
    });
  }

  const bridgeApi: LegacyAppBridgeApi = {
    activateNetwork,
    activateTelegramChat: (chatId) => {
      void selectTelegramChat(chatId, {
        forceScroll: true,
        showLoadingState: true,
      });
    },
    activateTelegramMessagesPane: () => {
      activateTelegramMessagesPane();
      syncTelegramActiveChatExposure();
      render();
      if (state.activeNetwork === 'telegram' && state.mode !== 'insert') {
        scheduleTelegramKeyboardSurfaceFocus();
      }
    },
    activateSelection: activateVimSelection,
    deleteSelection: () => {
      void deleteSelectedTelegramMessage();
    },
    cancelAuthPrompt,
    closeQrAuth: hideQrModal,
    executeCommand: executeCommandById,
    focusSearch: focusActiveSearch,
    forwardTelegramMessageToChat: forwardTelegramMessageToChatById,
    getCommands: () =>
      availableCommands().map((command) => ({
        id: command.id,
        label: command.label,
        group: command.group,
      })),
    getSnapshot,
    handleEscape: handleGlobalEscape,
    loadOlderTelegramMessages,
    movePane: moveVimPane,
    moveSelection: moveVimSelection,
    moveSelectionByPage,
    moveSelectionToEdge,
    openBrowser: () => {
      const active = getStatusByNetwork(state.activeNetwork);
      if (active.webUrl !== 'about:blank') {
        void window.pelec.openExternal(active.webUrl);
      }
    },
    appendTelegramFiles: (files) => {
      void appendTelegramFiles(files, 'selected');
    },
    clearTelegramReply: () => {
      clearTelegramReplyState();
      render();
    },
    closeTelegramContextMenu: () => {
      closeTelegramContextMenu();
    },
    closeTelegramForwardMenu: () => {
      closeTelegramForwardMenu();
    },
    closeTelegramImagePreview,
    copyTelegramMessage: copyTelegramMessageById,
    copyTelegramImagePreview: copyActiveTelegramImagePreview,
    downloadTelegramImagePreview: downloadActiveTelegramImagePreview,
    focusTelegramComposer,
    openTelegramContextMenu,
    openTelegramForwardMenu,
    openTelegramImagePreview,
    refreshQrAuth,
    removeTelegramAttachment,
    revealQrPassword,
    refresh: () => {
      if (state.activeNetwork === 'telegram') {
        void loadTelegramChats();
      } else {
        webviewMap.get(state.activeNetwork)?.reload();
      }
    },
    reply: beginReplyToSelectedTelegramMessage,
    selectTelegramMessage: (messageId) => {
      selectTelegramMessage(messageId);
      render();
      if (state.activeNetwork === 'telegram' && state.mode !== 'insert') {
        scheduleTelegramKeyboardSurfaceFocus();
      }
    },
    submitAuthPrompt,
    submitQrPassword,
    setTelegramForwardQuery,
    setTelegramMessagesVisible: (visible) => {
      reactTelegramMessagesVisible = visible;
      if (!visible && telegramReadAcknowledgeTimer !== null) {
        window.clearTimeout(telegramReadAcknowledgeTimer);
        telegramReadAcknowledgeTimer = null;
      }
      syncTelegramActiveChatExposure();
      if (visible) {
        scheduleTelegramReadAcknowledgement();
      }
    },
    sendTelegramMessage: () => {
      void sendTelegramMessage();
    },
    setTelegramDraftValue,
    setTelegramSearchQuery,
    startTelegramVoiceRecording: () => {
      void startTelegramVoiceRecording();
    },
    stopTelegramVoiceRecording: () => {
      stopTelegramVoiceRecording();
    },
    cancelTelegramVoiceRecording: () => {
      cancelTelegramVoiceRecording();
    },
    toggleSendBehavior: toggleRuntimeSendBehavior,
    setMode,
    startAuth: () => {
      void startAuthForNetwork(state.activeNetwork);
    },
    subscribe: (listener) => {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
  };

  bridge?.onReady?.(bridgeApi);
  emitSnapshotChange();

  await refreshConnectorStatuses();
  await loadTelegramChats();
  if (instagramEnabled) {
    await loadInstagramChats();
  }
  render();
};
