import './index.css';
import QRCode from 'qrcode';
import type {
  AuthStartResult,
  ChatMessage,
  ChatSummary,
  ConnectorUpdateEvent,
  ConnectorStatus,
} from './shared/connectors';
import type { AppMode, NetworkDefinition, NetworkId } from './shared/types';

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
  pendingTelegramImageDataUrls: string[];
  telegramLoading: boolean;
  telegramSearchQuery: string;
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
  run: () => void;
};

const appEl = document.querySelector<HTMLDivElement>('#app');

if (!appEl) {
  throw new Error('App root not found');
}

const INSTAGRAM_CHECKPOINT_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const INSTAGRAM_CHECKPOINT_COOLDOWN_KEY = 'pelec.instagramCheckpointCooldownUntil';

const readInstagramCooldownUntil = (): number => {
  const raw = window.localStorage.getItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY);
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    window.localStorage.removeItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY);
    return 0;
  }
  return parsed;
};

const writeInstagramCooldownUntil = (value: number): void => {
  window.localStorage.setItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY, String(value));
};

const checkpointInDetails = (value?: string): boolean =>
  (value ?? '').toLowerCase().includes('checkpoint');

const formatCooldownRemaining = (untilMs: number): string => {
  const remainingMs = Math.max(0, untilMs - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const formatMessageTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const renderStatusLine = (statusBar: HTMLElement, line: string): void => {
  const text = line.trim();
  const segments = text
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);
  statusBar.title = text;
  statusBar.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'status-shell';
  const left = document.createElement('div');
  left.className = 'status-left';
  const right = document.createElement('div');
  right.className = 'status-right';

  const createSegment = (value: string): HTMLElement => {
    const item = document.createElement('span');
    item.className = 'status-segment';
    const lowered = value.toLowerCase();
    if (lowered.startsWith('pane:')) {
      item.classList.add('pane');
    }
    if (lowered.includes('selected')) {
      item.classList.add('selected');
    }
    if (lowered.includes('active')) {
      item.classList.add('active');
    }
    if (lowered.includes('normal mode')) {
      item.classList.add('mode', 'mode-normal');
    } else if (lowered.includes('insert mode')) {
      item.classList.add('mode', 'mode-insert');
    }
    if (lowered.includes('fail') || lowered.includes('error')) {
      item.classList.add('error');
    }
    item.textContent = value;
    return item;
  };

  if (segments.length >= 3) {
    const leftSegments = segments.slice(0, Math.max(1, segments.length - 2));
    const rightSegments = segments.slice(Math.max(1, segments.length - 2));
    left.replaceChildren(...leftSegments.map(createSegment));
    right.replaceChildren(...rightSegments.map(createSegment));
  } else if (segments.length > 0) {
    left.replaceChildren(...segments.map(createSegment));
  } else {
    left.replaceChildren(createSegment(text || 'Ready'));
  }

  shell.replaceChildren(left, right);
  statusBar.append(shell);
};

const buildVoiceBarHeights = (seed: string, count = 38): number[] => {
  let value = 0;
  for (let i = 0; i < seed.length; i += 1) {
    value = (value * 33 + seed.charCodeAt(i)) >>> 0;
  }
  if (value === 0) {
    value = 0x9e3779b9;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    bars.push(20 + (value % 68));
  }
  return bars;
};

const boot = async (): Promise<void> => {
  const appConfig = await window.pelec.getConfig();
  const initialStatuses = await window.pelec.getConnectorStatuses();

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
    pendingTelegramImageDataUrls: [],
    telegramLoading: false,
    telegramSearchQuery: '',
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
  <div class="shell">
    <aside class="sidebar" aria-label="Networks">
      <div class="search-wrap">
        <input id="quick-filter" class="quick-filter" placeholder="/ to search networks" />
      </div>
      <nav id="network-list" class="network-list"></nav>
    </aside>
    <main class="content" aria-live="polite">
      <section id="views" class="views"></section>
      <footer id="status" class="status"></footer>
    </main>
  </div>
  `;

  appEl.append(commandPalette);

  const networkList = document.querySelector<HTMLElement>('#network-list');
  const shellEl = document.querySelector<HTMLElement>('.shell');
  const views = document.querySelector<HTMLElement>('#views');
  const statusBar = document.querySelector<HTMLElement>('#status');
  const quickFilter = document.querySelector<HTMLInputElement>('#quick-filter');

  if (
    !networkList ||
    !shellEl ||
    !views ||
    !statusBar ||
    !quickFilter
  ) {
    throw new Error('Required UI elements missing');
  }

  const webviewMap = new Map<NetworkId, Electron.WebviewTag>();
  let telegramChatsRequestSeq = 0;
  let telegramMessagesRequestSeq = 0;
  let lastRenderedTelegramChatId: string | null = null;
  let telegramForceScrollBottom = false;
  let telegramChatsRefreshTimer: number | null = null;
  let telegramMessagesRefreshTimer: number | null = null;
  let telegramMessagesHydrationTimer: number | null = null;
  let telegramScrollFollowupTimer: number | null = null;
  let instagramChatsRequestSeq = 0;
  let instagramMessagesRequestSeq = 0;
  let instagramForceScrollBottom = false;
  let instagramChatsRefreshTimer: number | null = null;
  let instagramMessagesRefreshTimer: number | null = null;
  let instagramChatsInFlight = false;
  let instagramMessagesInFlight = false;
  let telegramBackgroundRefreshTimer: number | null = null;
  let instagramBackgroundRefreshTimer: number | null = null;
  let instagramWebFallbackMonitorTimer: number | null = null;
  let telegramNotificationScanInFlight = false;
  let instagramNotificationScanInFlight = false;
  let instagramCheckpointCooldownUntil = readInstagramCooldownUntil();
  type NotificationCursor = {
    latestMessageId: string;
    latestTimestamp: number;
  };

  const notificationCursorByChat = new Map<string, NotificationCursor>();
  const lastUnreadCountByChat = new Map<string, number>();
  const notificationBaselineReady: Record<NetworkId, boolean> = {
    telegram: false,
    instagram: false,
  };
  let lastInstagramWebFallbackUnreadCount: number | null = null;
  let lastInstagramWebFallbackPreview: string | null = null;
  let lastInstagramWebFallbackSignature: string | null = null;

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
    const text = message.text.trim();
    const textLower = text.toLowerCase();
    if (message.stickerUrl && (textLower === 'sticker' || textLower.startsWith('sticker '))) {
      return `${message.sender}: [sticker${message.stickerEmoji ? ` ${message.stickerEmoji}` : ''}]`;
    }
    if (message.animationUrl && (textLower === 'gif/animation' || textLower === '[media]' || textLower === '[media_share]' || textLower === '[video]')) {
      return `${message.sender}: [animation]`;
    }
    if (text) {
      return `${message.sender}: ${text}`;
    }
    if (message.imageUrl) {
      return `${message.sender}: [image]`;
    }
    if (message.animationUrl) {
      return `${message.sender}: [animation]`;
    }
    if (message.stickerUrl) {
      return `${message.sender}: [sticker${message.stickerEmoji ? ` ${message.stickerEmoji}` : ''}]`;
    }
    if (message.hasAudio || message.audioUrl) {
      return `${message.sender}: [voice message]`;
    }
    return `${message.sender}: [message]`;
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
                .replace(/\\s+/g, ' ')
                .trim();

            const isUsefulText = (value) => {
              const text = normalize(value);
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

            const titlePreview = normalize(title.replace(/^\\(\\d+\\)\\s*/, ''));

            const isUnreadCandidate = (element) => {
              if (!(element instanceof HTMLElement)) {
                return false;
              }
              const style = window.getComputedStyle(element);
              const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
              return fontWeight >= 600 || style.fontWeight === 'bold';
            };

            const extractThreadPreview = () => {
              const rows = Array.from(
                document.querySelectorAll('a[href*="/direct/t/"], div[role="link"], div[role="button"], li'),
              );
              for (const row of rows) {
                if (!(row instanceof HTMLElement)) {
                  continue;
                }
                const rect = row.getBoundingClientRect();
                if (
                  rect.width < 120 ||
                  rect.height < 36 ||
                  rect.top < 0 ||
                  rect.top > window.innerHeight ||
                  rect.left > window.innerWidth * 0.7
                ) {
                  continue;
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
                  continue;
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
                  continue;
                }

                const sender = unreadTexts[0] || boldTexts[0] || allTexts[0] || '';
                const message =
                  unreadTexts.find((text) => text !== sender) ||
                  allTexts.find((text) => text !== sender) ||
                  '';

                if (sender && message) {
                  return sender + ': ' + message;
                }

                const ariaLabel = normalize(row.getAttribute('aria-label'));
                if (sender && isUsefulText(ariaLabel) && ariaLabel !== sender) {
                  return sender + ': ' + ariaLabel;
                }

                const rowText = normalize(row.innerText || row.textContent);
                if (isUsefulText(rowText)) {
                  return rowText;
                }
              }
              return '';
            };

            const extractInboxSignature = () => {
              const rows = Array.from(
                document.querySelectorAll('a[href*="/direct/t/"], div[role="link"], div[role="button"], li'),
              );
              const normalizedRows = [];
              for (const row of rows) {
                if (!(row instanceof HTMLElement)) {
                  continue;
                }
                const rect = row.getBoundingClientRect();
                if (
                  rect.width < 120 ||
                  rect.height < 36 ||
                  rect.top < 0 ||
                  rect.top > window.innerHeight ||
                  rect.left > window.innerWidth * 0.7
                ) {
                  continue;
                }
                const rowText = normalize(row.innerText || row.textContent);
                if (!rowText) {
                  continue;
                }
                normalizedRows.push(rowText);
                if (normalizedRows.length >= 8) {
                  break;
                }
              }
              return normalizedRows.join(' || ');
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
      const titlePreview = result?.titlePreview?.trim() ?? '';
      const rowPreview = result?.rowPreview?.trim() ?? '';
      const signature = result?.signature?.trim() ?? '';
      const preview =
        rowPreview ||
        (titlePreview &&
        isUsefulPreview(titlePreview)
          ? titlePreview
          : undefined);
      return { unreadCount, preview, signature: signature || undefined };
    } catch (error) {
      console.warn('Failed to inspect Instagram web fallback title.', error);
      return null;
    }
  };

  const pollInstagramWebFallbackNotifications = async (): Promise<void> => {
    const instagramStatus = getStatusByNetwork('instagram');
    if (instagramStatus.mode !== 'web-fallback') {
      lastInstagramWebFallbackUnreadCount = null;
      lastInstagramWebFallbackPreview = null;
      lastInstagramWebFallbackSignature = null;
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
    const { unreadCount, preview, signature } = nextState;

    if (lastInstagramWebFallbackUnreadCount === null) {
      lastInstagramWebFallbackUnreadCount = unreadCount;
      lastInstagramWebFallbackPreview = preview ?? null;
      lastInstagramWebFallbackSignature = signature ?? null;
      return;
    }

    const unreadIncreased = unreadCount > lastInstagramWebFallbackUnreadCount;
    const previewChanged =
      unreadCount > 0 &&
      Boolean(preview) &&
      preview !== lastInstagramWebFallbackPreview;
    const signatureChanged =
      unreadCount > 0 &&
      Boolean(signature) &&
      signature !== lastInstagramWebFallbackSignature;

    if ((unreadIncreased || previewChanged || signatureChanged) && !isWebFallbackVisible('instagram')) {
      const delta = Math.max(1, unreadCount - lastInstagramWebFallbackUnreadCount);
      const body =
        preview ||
        (delta === 1 ? 'New Instagram message' : `${delta} new Instagram messages`);
      void window.pelec.showNotification(
        'Instagram',
        body,
      );
    }

    lastInstagramWebFallbackUnreadCount = unreadCount;
    lastInstagramWebFallbackPreview = preview ?? null;
    lastInstagramWebFallbackSignature = signature ?? null;
  };

  const ensureInstagramWebFallbackMonitor = (): void => {
    const instagramStatus = getStatusByNetwork('instagram');
    if (instagramStatus.mode !== 'web-fallback') {
      if (instagramWebFallbackMonitorTimer !== null) {
        window.clearInterval(instagramWebFallbackMonitorTimer);
        instagramWebFallbackMonitorTimer = null;
      }
      lastInstagramWebFallbackUnreadCount = null;
      lastInstagramWebFallbackPreview = null;
      lastInstagramWebFallbackSignature = null;
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
  ): Promise<ChatMessage[]> => window.pelec.listConnectorMessages(network, chatId);

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
      window.localStorage.removeItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY);
      return false;
    }
    return true;
  };

  const setInstagramCheckpointCooldown = (reason: string): void => {
    const until = Date.now() + INSTAGRAM_CHECKPOINT_COOLDOWN_MS;
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
        <div class="telegram-hamburger">☰</div>
        <input class="telegram-search" placeholder="Search" />
      </header>
      <section id="telegram-chat-list" class="telegram-chat-list"></section>
    </aside>
    <section class="telegram-chat-pane">
      <header id="telegram-chat-title" class="telegram-chat-title">Telegram</header>
      <div id="telegram-message-list" class="telegram-message-list"></div>
      <footer class="telegram-composer">
        <div id="telegram-compose-attachment" class="telegram-compose-attachment hidden"></div>
        <div class="telegram-compose-row">
          <input id="telegram-compose-input" class="telegram-compose-input" placeholder="Message" />
          <button id="telegram-send-button" class="telegram-send-button" type="button">➤</button>
        </div>
      </footer>
    </section>
  `;
  views.append(nativeTelegram);

  const telegramChatListEl = nativeTelegram.querySelector<HTMLElement>('#telegram-chat-list');
  const telegramChatTitleEl = nativeTelegram.querySelector<HTMLElement>('#telegram-chat-title');
  const telegramMessageListEl = nativeTelegram.querySelector<HTMLElement>('#telegram-message-list');
  const telegramSearchInput = nativeTelegram.querySelector<HTMLInputElement>('.telegram-search');
  const telegramComposeAttachment = nativeTelegram.querySelector<HTMLElement>('#telegram-compose-attachment');
  const telegramComposeInput = nativeTelegram.querySelector<HTMLInputElement>('#telegram-compose-input');
  const telegramSendButton = nativeTelegram.querySelector<HTMLButtonElement>('#telegram-send-button');

  if (
    !telegramChatListEl ||
    !telegramChatTitleEl ||
    !telegramMessageListEl ||
    !telegramSearchInput ||
    !telegramComposeAttachment ||
    !telegramComposeInput ||
    !telegramSendButton
  ) {
    throw new Error('Native Telegram UI elements missing');
  }

  const instagramWebShell = document.createElement('section');
  instagramWebShell.className = 'instagram-web-shell hidden';
  instagramWebShell.innerHTML = `
    <div class="instagram-web-stage">
      <div class="instagram-web-frame">
        <div id="instagram-webview-host" class="instagram-webview-host"></div>
      </div>
    </div>
  `;
  views.append(instagramWebShell);

  const instagramWebviewHost = instagramWebShell.querySelector<HTMLElement>('#instagram-webview-host');

  if (!instagramWebviewHost) {
    throw new Error('Instagram web shell elements missing');
  }

  const qrModal = document.createElement('div');
  qrModal.className = 'qr-modal hidden';
  qrModal.innerHTML = `
    <div class="qr-card">
      <h3>Telegram QR Login</h3>
      <p class="qr-subtitle">Scan with Telegram app, then continue to password.</p>
      <canvas id="qr-canvas" width="260" height="260"></canvas>
      <div class="qr-primary-actions">
        <button id="qr-refresh" class="ghost-button" type="button">Refresh QR</button>
        <button id="qr-scanned" class="ghost-button" type="button">I scanned the QR</button>
        <button id="qr-close" class="ghost-button" type="button">Close</button>
      </div>
      <div id="qr-password-wrap" class="qr-password-wrap hidden">
        <input id="qr-password-input" class="quick-filter" type="password" placeholder="2FA password" />
        <div class="qr-actions">
          <button id="qr-password-submit" class="ghost-button" type="button">Submit Password</button>
        </div>
      </div>
    </div>
  `;
  appEl.append(qrModal);

  const qrCanvas = qrModal.querySelector<HTMLCanvasElement>('#qr-canvas');
  const qrRefreshButton = qrModal.querySelector<HTMLButtonElement>('#qr-refresh');
  const qrScannedButton = qrModal.querySelector<HTMLButtonElement>('#qr-scanned');
  const qrPasswordWrap = qrModal.querySelector<HTMLDivElement>('#qr-password-wrap');
  const qrPasswordInput = qrModal.querySelector<HTMLInputElement>('#qr-password-input');
  const qrPasswordSubmit = qrModal.querySelector<HTMLButtonElement>('#qr-password-submit');
  const qrClose = qrModal.querySelector<HTMLButtonElement>('#qr-close');

  if (
    !qrCanvas ||
    !qrRefreshButton ||
    !qrScannedButton ||
    !qrPasswordWrap ||
    !qrPasswordInput ||
    !qrPasswordSubmit ||
    !qrClose
  ) {
    throw new Error('QR modal elements missing');
  }

  const authModal = document.createElement('div');
  authModal.className = 'qr-modal hidden';
  authModal.innerHTML = `
    <div class="qr-card">
      <div id="auth-step" class="auth-step hidden"></div>
      <h3 id="auth-title">Authentication</h3>
      <p id="auth-message" class="qr-subtitle"></p>
      <label id="auth-label" class="auth-label" for="auth-input"></label>
      <div class="auth-input-shell">
        <input id="auth-input" class="quick-filter auth-input" type="text" />
      </div>
      <div class="qr-actions">
        <button id="auth-submit" class="ghost-button" type="button">Submit</button>
        <button id="auth-cancel" class="ghost-button" type="button">Cancel</button>
      </div>
    </div>
  `;
  appEl.append(authModal);

  const authTitleEl = authModal.querySelector<HTMLHeadingElement>('#auth-title');
  const authStepEl = authModal.querySelector<HTMLDivElement>('#auth-step');
  const authMessageEl = authModal.querySelector<HTMLParagraphElement>('#auth-message');
  const authLabelEl = authModal.querySelector<HTMLLabelElement>('#auth-label');
  const authInputEl = authModal.querySelector<HTMLInputElement>('#auth-input');
  const authSubmitEl = authModal.querySelector<HTMLButtonElement>('#auth-submit');
  const authCancelEl = authModal.querySelector<HTMLButtonElement>('#auth-cancel');

  if (!authTitleEl || !authStepEl || !authMessageEl || !authLabelEl || !authInputEl || !authSubmitEl || !authCancelEl) {
    throw new Error('Auth modal elements missing');
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

  const telegramImagePreviewEl =
    telegramImageModal.querySelector<HTMLImageElement>('#telegram-image-preview');
  const telegramImageCopyEl =
    telegramImageModal.querySelector<HTMLButtonElement>('#telegram-image-copy');
  const telegramImageDownloadEl =
    telegramImageModal.querySelector<HTMLButtonElement>('#telegram-image-download');
  const telegramImageCloseEl =
    telegramImageModal.querySelector<HTMLButtonElement>('#telegram-image-close');

  if (
    !telegramImagePreviewEl ||
    !telegramImageCopyEl ||
    !telegramImageDownloadEl ||
    !telegramImageCloseEl
  ) {
    throw new Error('Telegram image modal elements missing');
  }

  let qrStatusPollTimer: number | null = null;
  let qrStatusPollBusy = false;
  let instagramBrowserSessionPollTimer: number | null = null;
  let instagramBrowserSessionPollBusy = false;
  let activeTelegramImageUrl: string | null = null;

  const closeTelegramImagePreview = (): void => {
    activeTelegramImageUrl = null;
    telegramImagePreviewEl.removeAttribute('src');
    telegramImageModal.classList.add('hidden');
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

  const openTelegramImagePreview = (url: string): void => {
    activeTelegramImageUrl = url;
    telegramImagePreviewEl.src = url;
    telegramImageModal.classList.remove('hidden');
  };

  telegramImageCopyEl.addEventListener('click', () => {
    if (!activeTelegramImageUrl) {
      return;
    }
    void copyTelegramImage(activeTelegramImageUrl);
  });

  telegramImageDownloadEl.addEventListener('click', () => {
    if (!activeTelegramImageUrl) {
      return;
    }
    downloadTelegramImage(activeTelegramImageUrl);
  });

  telegramImageCloseEl.addEventListener('click', () => {
    closeTelegramImagePreview();
  });

  telegramImageModal.addEventListener('click', (event) => {
    if (event.target === telegramImageModal) {
      closeTelegramImagePreview();
    }
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
      let done = false;

      const finalize = (value: string | null): void => {
        if (done) {
          return;
        }
        done = true;
        authModal.classList.add('hidden');
        authSubmitEl.removeEventListener('click', onSubmit);
        authCancelEl.removeEventListener('click', handleCancel);
        authInputEl.removeEventListener('keydown', onKeyDown);
        resolve(value);
      };

      const onSubmit = (): void => {
        const value = trim ? authInputEl.value.trim() : authInputEl.value;
        finalize(value || null);
      };

      const handleCancel = (): void => {
        void onCancel?.();
        finalize(null);
      };

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSubmit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          handleCancel();
        }
      };

      authTitleEl.textContent = title;
      authStepEl.textContent = stepLabel ?? '';
      authStepEl.classList.toggle('hidden', !stepLabel);
      authMessageEl.textContent = message;
      authLabelEl.textContent = label;
      authInputEl.placeholder = placeholder;
      authInputEl.type = secret ? 'password' : 'text';
      authInputEl.value = '';
      authSubmitEl.textContent = submitLabel;
      authModal.classList.remove('hidden');

      authSubmitEl.addEventListener('click', onSubmit);
      authCancelEl.addEventListener('click', handleCancel);
      authInputEl.addEventListener('keydown', onKeyDown);

      window.setTimeout(() => authInputEl.focus(), 0);
    });

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
    qrModal.classList.add('hidden');
    qrPasswordWrap.classList.add('hidden');
    stopQrStatusPolling();
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
      const network = getNetworkById(id);
      return {
        network: id,
        mode: 'web-fallback',
        authState: 'unauthenticated',
        capabilities: { qr: false, twoFactor: false, officialApi: false },
        partition: network.partition,
        webUrl: network.homeUrl,
        details: 'No connector status available. Using web fallback.',
      };
    }
    return status;
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
    const status = getStatusByNetwork('instagram');
    return status.mode === 'native' && status.authState === 'authenticated';
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
        a[i].unreadCount !== b[i].unreadCount ||
        a[i].avatarUrl !== b[i].avatarUrl ||
        a[i].isMuted !== b[i].isMuted
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
        a[i].sender !== b[i].sender ||
        a[i].text !== b[i].text ||
        a[i].timestamp !== b[i].timestamp ||
        a[i].outgoing !== b[i].outgoing ||
        a[i].readByPeer !== b[i].readByPeer ||
        a[i].imageUrl !== b[i].imageUrl ||
        a[i].animationUrl !== b[i].animationUrl ||
        a[i].animationMimeType !== b[i].animationMimeType ||
        a[i].stickerUrl !== b[i].stickerUrl ||
        a[i].stickerEmoji !== b[i].stickerEmoji ||
        a[i].stickerIsAnimated !== b[i].stickerIsAnimated ||
        !reactionsEqual ||
        a[i].hasAudio !== b[i].hasAudio ||
        a[i].audioDurationSeconds !== b[i].audioDurationSeconds ||
        a[i].senderAvatarUrl !== b[i].senderAvatarUrl
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
      const haystack = `${chat.title} ${chat.lastMessagePreview}`.toLowerCase();
      return haystack.includes(normalized);
    });
  };

  const INSTAGRAM_WEBVIEW_THEME_CSS = `
    :root {
      --pelec-bg-0: #050607;
      --pelec-bg-1: #090b0d;
      --pelec-bg-2: #0d1013;
      --pelec-bg-3: #12161a;
      --pelec-bg-4: #171c21;
      --pelec-line: rgba(255, 255, 255, 0.08);
      --pelec-line-strong: rgba(255, 255, 255, 0.16);
      --pelec-ink: #f1f3f4;
      --pelec-muted: #9aa0a6;
      --pelec-accent: #d1d5db;
      --pelec-accent-soft: rgba(255, 255, 255, 0.04);
      --pelec-accent-strong: #e5e7eb;
    }

    html, body {
      background: var(--pelec-bg-0) !important;
      color: var(--pelec-ink) !important;
    }

    * {
      font-family: "Iosevka", "Iosevka Mono", "JetBrains Mono", "IBM Plex Mono", monospace !important;
      border-radius: 0 !important;
    }

    html {
      font-size: 15px !important;
    }

    body {
      font-size: 1rem !important;
      line-height: 1.38 !important;
    }

    input,
    textarea,
    button,
    [role="button"],
    [role="link"],
    [contenteditable="true"],
    span,
    a,
    p,
    h1,
    h2,
    h3,
    h4,
    li,
    div {
      font-size: inherit !important;
    }

    body, input, textarea, button, div, section, main, nav, header, footer, aside, article {
      scrollbar-width: none !important;
    }

    body::-webkit-scrollbar, *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    nav,
    header,
    section,
    main,
    article,
    aside,
    ul,
    li,
    [role="main"],
    [role="dialog"],
    [role="menu"],
    [role="presentation"],
    [role="listbox"],
    [role="grid"],
    [role="list"],
    [role="textbox"],
    [aria-label="Inbox"],
    [aria-label="Direct"],
    [aria-label="Chats"] {
      border-color: var(--pelec-line) !important;
    }

    nav,
    header,
    li,
    [role="dialog"] > div,
    [role="menu"] > div,
    form,
    textarea,
    input,
    button {
      border-radius: 0 !important;
    }

    input,
    textarea,
    [contenteditable="true"] {
      background: var(--pelec-bg-1) !important;
      color: var(--pelec-ink) !important;
      border-color: var(--pelec-line) !important;
      box-shadow: none !important;
      padding-top: 0.7rem !important;
      padding-bottom: 0.7rem !important;
    }

    input::placeholder,
    textarea::placeholder {
      color: #7f868d !important;
    }

    a,
    a:visited {
      color: #f1f3f4 !important;
    }

    button,
    [role="button"] {
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease !important;
    }

    button:hover,
    [role="button"]:hover {
      background: var(--pelec-accent-soft) !important;
    }

    button,
    [role="button"],
    [role="link"] {
      color: var(--pelec-ink) !important;
      border-color: var(--pelec-line) !important;
    }

    button:focus,
    [role="button"]:focus,
    input:focus,
    textarea:focus,
    [contenteditable="true"]:focus {
      outline: none !important;
      border-color: var(--pelec-line-strong) !important;
      box-shadow: inset 2px 0 0 var(--pelec-accent) !important;
    }

    main,
    nav,
    section,
    article,
    header,
    aside,
    form,
    [role="main"],
    [role="dialog"] > div,
    [role="menu"] > div,
    [role="listbox"],
    [role="grid"],
    [role="list"],
    [role="presentation"] {
      background-color: var(--pelec-bg-0) !important;
    }

    nav,
    aside,
    header {
      background:
        linear-gradient(180deg, rgba(9, 11, 13, 0.98) 0%, rgba(5, 6, 7, 0.98) 100%) !important;
    }

    main,
    section,
    article,
    [role="main"] {
      background: var(--pelec-bg-0) !important;
    }

    input,
    textarea,
    [role="textbox"],
    [contenteditable="true"] {
      background: rgba(9, 11, 13, 0.96) !important;
    }

    button,
    [role="button"] {
      background: rgba(13, 16, 19, 0.96) !important;
      min-height: 2.4rem !important;
    }

    [aria-selected="true"],
    [aria-current="page"],
    [aria-current="true"],
    [role="tab"][aria-selected="true"] {
      background: rgba(18, 22, 26, 0.98) !important;
      box-shadow: inset 2px 0 0 var(--pelec-accent) !important;
    }

    [href="/direct/inbox/"],
    a[href*="/direct/"],
    [aria-label*="Messages"],
    [aria-label*="Direct"] {
      color: #f3f4f6 !important;
    }

    svg,
    path {
      color: currentColor !important;
    }

    [style*="background-color: rgb(255, 255, 255)"],
    [style*="background: rgb(255, 255, 255)"],
    [style*="background-color:#fff"],
    [style*="background:#fff"],
    [style*="background-color: white"],
    [style*="background: white"] {
      background: var(--pelec-bg-1) !important;
      color: var(--pelec-ink) !important;
    }

    [style*="border-color: rgb(219, 219, 219)"],
    [style*="border-top-color: rgb(219, 219, 219)"],
    [style*="border-right-color: rgb(219, 219, 219)"],
    [style*="border-bottom-color: rgb(219, 219, 219)"],
    [style*="border-left-color: rgb(219, 219, 219)"] {
      border-color: var(--pelec-line) !important;
    }

    [style*="color: rgb(38, 38, 38)"],
    [style*="color: rgb(0, 0, 0)"] {
      color: var(--pelec-ink) !important;
    }

    [style*="color: rgb(115, 115, 115)"],
    [style*="color: rgb(142, 142, 142)"] {
      color: var(--pelec-muted) !important;
    }

    [style*="background-color: rgb(239, 239, 239)"],
    [style*="background: rgb(239, 239, 239)"] {
      background: var(--pelec-bg-2) !important;
    }

    [style*="background-color: rgb(18, 18, 18)"],
    [style*="background: rgb(18, 18, 18)"],
    [style*="background-color: rgb(0, 0, 0)"],
    [style*="background: rgb(0, 0, 0)"] {
      background: var(--pelec-bg-0) !important;
    }

    [style*="background-color: rgb(0, 149, 246)"],
    [style*="background: rgb(0, 149, 246)"],
    [style*="color: rgb(0, 149, 246)"] {
      background: rgba(18, 22, 26, 0.96) !important;
      border-color: rgba(255, 255, 255, 0.14) !important;
      color: #f3f4f6 !important;
    }

    [style*="background-color: rgb(54, 54, 54)"],
    [style*="background: rgb(54, 54, 54)"],
    [style*="background-color: rgb(38, 38, 38)"],
    [style*="background: rgb(38, 38, 38)"] {
      background: var(--pelec-bg-1) !important;
    }

    [style*="background-color: rgb(32, 32, 32)"],
    [style*="background: rgb(32, 32, 32)"],
    [style*="background-color: rgb(30, 30, 30)"],
    [style*="background: rgb(30, 30, 30)"],
    [style*="background-color: rgb(28, 28, 28)"],
    [style*="background: rgb(28, 28, 28)"] {
      background: var(--pelec-bg-1) !important;
    }

    [style*="background-color: rgb(23, 23, 23)"],
    [style*="background: rgb(23, 23, 23)"],
    [style*="background-color: rgb(26, 26, 26)"],
    [style*="background: rgb(26, 26, 26)"] {
      background: var(--pelec-bg-0) !important;
    }

    [style*="background-color: rgb(250, 250, 250)"],
    [style*="background: rgb(250, 250, 250)"],
    [style*="background-color: rgb(239, 239, 239)"],
    [style*="background: rgb(239, 239, 239)"] {
      background: var(--pelec-bg-2) !important;
    }

    /* Story/note tiles at the top should use the same flat panel background. */
    a:has(img),
    div:has(> img),
    button:has(img) {
      background-color: transparent !important;
    }

    a:has(img) > div,
    button:has(img) > div,
    div:has(> img) > div {
      background: var(--pelec-bg-1) !important;
    }

    [style*="background: linear-gradient"] {
      filter: saturate(0.88) contrast(0.98) brightness(0.96) !important;
    }

    svg[aria-label="Instagram"],
    svg[aria-label="Home"],
    svg[aria-label="Search"] {
      color: var(--pelec-ink) !important;
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

              document.documentElement.style.background = '#0d0a12';
              document.body && (document.body.style.background = '#0d0a12');
              document.documentElement.setAttribute('data-pelec-instagram-theme', '1');

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

    view.addEventListener('did-start-loading', () => {
      state.loading[network.id] = true;
      render();
    });

    if (network.id === 'instagram') {
      view.addEventListener('dom-ready', () => {
        void injectInstagramWebTheme(view);
        void pollInstagramWebFallbackNotifications();
      });
    }

    view.addEventListener('did-stop-loading', () => {
      state.loading[network.id] = false;
      if (network.id === 'instagram') {
        void injectInstagramWebTheme(view);
        void pollInstagramWebFallbackNotifications();
      }
      render();

      if (network.id === 'instagram' && isInstagramCheckpointCooldownActive()) {
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

    if (network.id === 'instagram') {
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
  ): Promise<void> => {
    const requestSeq = ++telegramMessagesRequestSeq;
    state.activeTelegramChatId = chatId;
    const messages = await window.pelec.listConnectorMessages('telegram', chatId);
    if (requestSeq !== telegramMessagesRequestSeq || chatId !== state.activeTelegramChatId) {
      return;
    }
    const changed = !areMessageListsEqual(state.telegramMessages, messages);
    const chatTitle =
      state.telegramChats.find((chat) => chat.id === chatId)?.title ?? 'Telegram';
    maybeNotifyNewMessages('telegram', chatId, chatTitle, messages, suppressNotification);
    state.telegramMessages = messages;
    state.selectedTelegramMessageId = messages[messages.length - 1]?.id ?? null;
    await window.pelec.setConnectorActiveChat('telegram', chatId);
    if (changed || forceScroll) {
      telegramForceScrollBottom = true;
      render();
    }

    // TDLib can return a partial first page right after chat open; re-fetch once to hydrate.
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
  };

  const loadTelegramChats = async (): Promise<void> => {
    const requestSeq = ++telegramChatsRequestSeq;
    const telegramStatus = getStatusByNetwork('telegram');
    if (!(telegramStatus.mode === 'native' && telegramStatus.authState === 'authenticated')) {
      void window.pelec.setConnectorActiveChat('telegram', null);
      resetNotificationTracking('telegram');
      state.telegramChats = [];
      state.telegramMessages = [];
      state.activeTelegramChatId = null;
      state.selectedTelegramChatId = null;
      state.selectedTelegramMessageId = null;
      state.replyingToMessageId = null;
      state.replyingToSender = null;
      state.pendingTelegramImageDataUrls = [];
      render();
      return;
    }

    const hasExistingChats = state.telegramChats.length > 0;
    state.telegramLoading = !hasExistingChats;
    if (!hasExistingChats) {
      render();
    }

    const chats = await window.pelec.listConnectorChats('telegram');
    if (requestSeq !== telegramChatsRequestSeq) {
      return;
    }
    const chatsChanged = !areChatListsEqual(state.telegramChats, chats);
    state.telegramChats = chats;
    state.telegramLoading = false;
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

    if (state.activeTelegramChatId) {
      await loadTelegramMessages(state.activeTelegramChatId, 0, false, suppressNotifications);
    } else if (chatsChanged) {
      render();
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

    if (getStatusByNetwork('telegram').mode === 'native' && getStatusByNetwork('telegram').authState === 'authenticated') {
      scheduleBackgroundRefresh('telegram', 5000);
    }
  };

  const loadInstagramMessages = async (chatId: string): Promise<void> => {
    if (instagramMessagesInFlight) {
      return;
    }
    instagramMessagesInFlight = true;
    const requestSeq = ++instagramMessagesRequestSeq;
    try {
      state.activeInstagramChatId = chatId;
      const messages = await window.pelec.listConnectorMessages('instagram', chatId);
      if (requestSeq !== instagramMessagesRequestSeq || chatId !== state.activeInstagramChatId) {
        return;
      }
      const changed = !areMessageListsEqual(state.instagramMessages, messages);
      const chatTitle =
        state.instagramChats.find((chat) => chat.id === chatId)?.title ?? 'Instagram';
      maybeNotifyNewMessages('instagram', chatId, chatTitle, messages);
      state.instagramMessages = messages;
      state.selectedInstagramMessageId = messages[messages.length - 1]?.id ?? null;
      if (changed) {
        instagramForceScrollBottom = true;
        render();
      }
    } finally {
      instagramMessagesInFlight = false;
    }
  };

  const loadInstagramChats = async (): Promise<void> => {
    if (instagramChatsInFlight) {
      return;
    }
    instagramChatsInFlight = true;
    const requestSeq = ++instagramChatsRequestSeq;
    try {
      if (!isInstagramNativeReady()) {
        resetNotificationTracking('instagram');
        state.instagramChats = [];
        state.instagramMessages = [];
        state.activeInstagramChatId = null;
        state.selectedInstagramChatId = null;
        state.selectedInstagramMessageId = null;
        state.replyingToInstagramMessageId = null;
        state.replyingToInstagramSender = null;
        render();
        return;
      }

      const hasExistingChats = state.instagramChats.length > 0;
      state.instagramLoading = !hasExistingChats;
      if (!hasExistingChats) {
        render();
      }

      const chats = await window.pelec.listConnectorChats('instagram');
      if (requestSeq !== instagramChatsRequestSeq) {
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

      if (state.activeInstagramChatId) {
        await loadInstagramMessages(state.activeInstagramChatId);
      } else if (chatsChanged) {
        render();
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
        scheduleBackgroundRefresh('instagram', 7000);
      }
    } finally {
      state.instagramLoading = false;
      instagramChatsInFlight = false;
    }
  };

  const scheduleBackgroundRefresh = (
    network: NetworkId,
    delayMs: number,
  ): void => {
    const currentTimer =
      network === 'telegram' ? telegramBackgroundRefreshTimer : instagramBackgroundRefreshTimer;
    if (currentTimer !== null) {
      window.clearTimeout(currentTimer);
    }

    const nextTimer = window.setTimeout(() => {
      if (network === 'telegram') {
        telegramBackgroundRefreshTimer = null;
        void loadTelegramChats();
      } else {
        instagramBackgroundRefreshTimer = null;
        void loadInstagramChats();
      }
    }, delayMs);

    if (network === 'telegram') {
      telegramBackgroundRefreshTimer = nextTimer;
    } else {
      instagramBackgroundRefreshTimer = nextTimer;
    }
  };

  const ensureBackgroundRefreshLoops = (): void => {
    const telegramStatus = getStatusByNetwork('telegram');
    if (telegramStatus.mode === 'native' && telegramStatus.authState === 'authenticated') {
      scheduleBackgroundRefresh('telegram', 5000);
    } else if (telegramBackgroundRefreshTimer !== null) {
      window.clearTimeout(telegramBackgroundRefreshTimer);
      telegramBackgroundRefreshTimer = null;
    }

    const instagramStatus = getStatusByNetwork('instagram');
    if (instagramStatus.mode === 'native' && instagramStatus.authState === 'authenticated') {
      scheduleBackgroundRefresh('instagram', 7000);
    } else if (instagramBackgroundRefreshTimer !== null) {
      window.clearTimeout(instagramBackgroundRefreshTimer);
      instagramBackgroundRefreshTimer = null;
    }
  };

  const refreshConnectorStatuses = async (): Promise<void> => {
    const next = await window.pelec.getConnectorStatuses();
    state.connectorStatuses = Object.fromEntries(
      next.map((status) => [status.network, status]),
    ) as Record<NetworkId, ConnectorStatus>;
    ensureBackgroundRefreshLoops();
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
    state.mode = mode;
    if (mode === 'normal') {
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
    state.activeNetwork = id;
    state.selectedNetwork = id;
    const activeWebview = webviewMap.get(id);
    activeWebview?.focus();
    statusBar.textContent = `Active ${getNetworkById(id).name}`;

    if (id === 'telegram') {
      state.vimPane = 'telegram-chats';
      void loadTelegramChats();
    } else if (id === 'instagram') {
      state.vimPane = 'networks';
    } else {
      state.vimPane = 'networks';
    }

    render();
  };

  const sendTelegramMessage = async (): Promise<void> => {
    if (state.activeNetwork !== 'telegram' || !state.activeTelegramChatId) {
      return;
    }

    const text = telegramComposeInput.value.trim();
    const hasImage = state.pendingTelegramImageDataUrls.length > 0;
    if (!text && !hasImage) {
      return;
    }

    telegramSendButton.disabled = true;
    try {
      let sent = true;
      if (hasImage) {
        for (let index = 0; index < state.pendingTelegramImageDataUrls.length; index += 1) {
          const imageDataUrl = state.pendingTelegramImageDataUrls[index];
          const caption = index === 0 ? text : '';
          const imageSent = await window.pelec.sendConnectorImage(
            'telegram',
            state.activeTelegramChatId,
            imageDataUrl,
            caption,
            state.replyingToMessageId ?? undefined,
          );
          if (!imageSent) {
            sent = false;
            break;
          }
        }
      } else {
        sent = await window.pelec.sendConnectorMessage(
            'telegram',
            state.activeTelegramChatId,
            text,
            state.replyingToMessageId ?? undefined,
          );
      }
      if (!sent) {
        await refreshConnectorStatuses();
        const status = getStatusByNetwork('telegram');
        statusBar.textContent = `Failed to send: ${status.lastError ?? status.details}`;
        render();
        return;
      }
      telegramComposeInput.value = '';
      state.pendingTelegramImageDataUrls = [];
      state.replyingToMessageId = null;
      state.replyingToSender = null;
      state.pendingTelegramImageDataUrls = [];
      telegramForceScrollBottom = true;
      await loadTelegramMessages(state.activeTelegramChatId);
    } finally {
      telegramSendButton.disabled = false;
    }
  };

  const scheduleTelegramChatsRefresh = (delayMs = 300): void => {
    if (telegramChatsRefreshTimer !== null) {
      window.clearTimeout(telegramChatsRefreshTimer);
    }
    telegramChatsRefreshTimer = window.setTimeout(() => {
      telegramChatsRefreshTimer = null;
      void loadTelegramChats();
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
      if (state.telegramMessages.length < 1) {
        return;
      }
      const step = Math.max(1, Math.floor(state.telegramMessages.length / 4));
      const currentIndex = state.telegramMessages.findIndex(
        (message) => message.id === state.selectedTelegramMessageId,
      );
      const safeIndex = currentIndex === -1 ? state.telegramMessages.length - 1 : currentIndex;
      const nextIndex = Math.min(
        state.telegramMessages.length - 1,
        Math.max(0, safeIndex + direction * step),
      );
      state.selectedTelegramMessageId = state.telegramMessages[nextIndex].id;
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
      if (state.telegramMessages.length < 1) {
        return;
      }
      state.selectedTelegramMessageId =
        edge === 'first'
          ? state.telegramMessages[0].id
          : state.telegramMessages[state.telegramMessages.length - 1].id;
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
      state.vimPane = 'networks';
      render();
      return;
    }
    const panes: Array<AppState['vimPane']> =
      state.activeNetwork === 'instagram'
        ? ['networks', 'instagram-chats', 'instagram-messages']
        : ['networks', 'telegram-chats', 'telegram-messages'];
    const currentIndex = panes.indexOf(state.vimPane);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(panes.length - 1, safeIndex + direction));
    state.vimPane = panes[nextIndex];
    render();
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
      if (state.telegramMessages.length < 1) {
        return;
      }
      const currentIndex = state.telegramMessages.findIndex(
        (message) => message.id === state.selectedTelegramMessageId,
      );
      const safeIndex = currentIndex === -1 ? state.telegramMessages.length - 1 : currentIndex;
      const nextIndex = Math.min(
        state.telegramMessages.length - 1,
        Math.max(0, safeIndex + direction),
      );
      state.selectedTelegramMessageId = state.telegramMessages[nextIndex].id;
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
        state.replyingToMessageId = null;
        state.replyingToSender = null;
        state.pendingTelegramImageDataUrls = [];
        void loadTelegramMessages(nextChatId, 0, true);
      }
      return;
    }

    if (state.activeNetwork === 'telegram' && state.vimPane === 'telegram-messages') {
      const selected = telegramMessageListEl.querySelector<HTMLElement>('.telegram-message-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
      return;
    }

    activateNetwork(state.selectedNetwork);
  };

  const findSelectedTelegramMessage = (): ChatMessage | undefined => {
    if (!state.selectedTelegramMessageId) {
      return undefined;
    }
    return state.telegramMessages.find((message) => message.id === state.selectedTelegramMessageId);
  };

  const deleteSelectedTelegramMessage = async (): Promise<void> => {
    if (state.activeNetwork !== 'telegram' || !state.activeTelegramChatId) {
      return;
    }
    const selected = findSelectedTelegramMessage();
    if (!selected) {
      return;
    }

    const deleted = await window.pelec.deleteConnectorMessage(
      'telegram',
      state.activeTelegramChatId,
      selected.id,
    );
    if (!deleted) {
      await refreshConnectorStatuses();
      const status = getStatusByNetwork('telegram');
      statusBar.textContent = `Delete failed: ${status.lastError ?? status.details}`;
      return;
    }

    if (state.replyingToMessageId === selected.id) {
      state.replyingToMessageId = null;
      state.replyingToSender = null;
      state.pendingTelegramImageDataUrls = [];
    }
    await loadTelegramMessages(state.activeTelegramChatId);
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
    state.replyingToMessageId = selected.id;
    state.replyingToSender = selected.sender;
    setMode('insert');
    statusBar.textContent = `Replying to ${selected.sender}`;
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
        stopInstagramBrowserSessionPolling();
        setMode('normal');
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
        onCancel: () => {
          if (result.network === 'instagram') {
            stopInstagramBrowserSessionPolling();
            return window.pelec.resetConnectorAuth('instagram');
          }
          return undefined;
        },
      });
      if (!code) {
        await refreshConnectorStatuses();
        render();
        return;
      }
      await window.pelec.submitConnectorAuth(result.network, {
        type: 'code',
        value: code,
      });
      await refreshConnectorStatuses();
      if (result.network === 'instagram') {
        stopInstagramBrowserSessionPolling();
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
      if (result.qrLink) {
        await QRCode.toCanvas(qrCanvas, result.qrLink, {
          margin: 1,
          width: 260,
        });
      } else {
        const ctx = qrCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        }
      }

      qrPasswordInput.value = '';
      qrPasswordWrap.classList.add('hidden');
      qrModal.classList.remove('hidden');
      startQrStatusPolling(result.network);
      setMode('normal');

      qrRefreshButton.onclick = () => {
        statusBar.textContent = 'Requesting a fresh Telegram QR...';
        void startAuthForNetwork(result.network);
      };

      qrScannedButton.onclick = () => {
        qrPasswordWrap.classList.remove('hidden');
        qrPasswordInput.focus();
      };

      qrPasswordSubmit.onclick = async () => {
        const password = qrPasswordInput.value.trim();
        if (password) {
          await window.pelec.submitConnectorAuth(result.network, {
            type: 'password',
            value: password,
          });
          await refreshConnectorStatuses();
          const status = getStatusByNetwork(result.network);
          if (status.authState === 'authenticated') {
            hideQrModal();
            await loadTelegramChats();
          } else {
            statusBar.textContent = status.details;
          }
          render();
        }
      };

      qrClose.onclick = () => {
        hideQrModal();
      };

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
      run: () => activateNetwork(network.id),
    })),
    ...appConfig.networks.map((network) => ({
      id: `auth-${network.id}`,
      label: `auth ${network.id}`,
      run: () => {
        void startAuthForNetwork(network.id);
      },
    })),
    {
      id: 'refresh-connectors',
      label: 'refresh connectors',
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
      run: () => {
        void loadTelegramChats();
      },
    },
    {
      id: 'refresh-instagram',
      label: 'refresh instagram',
      run: () => {
        void refreshConnectorStatuses().then(() => {
          webviewMap.get('instagram')?.reload();
          render();
        });
      },
    },
    {
      id: 'reset-instagram-auth',
      label: 'reset instagram auth',
      run: () => {
        void window.pelec.resetConnectorAuth('instagram').then(async () => {
          stopInstagramBrowserSessionPolling();
          await refreshConnectorStatuses();
          statusBar.textContent = 'Instagram auth reset.';
          render();
        });
      },
    },
    {
      id: 'mode-normal',
      label: 'mode normal',
      run: () => setMode('normal'),
    },
    {
      id: 'mode-insert',
      label: 'mode insert',
      run: () => setMode('insert'),
    },
    {
      id: 'open-browser',
      label: 'open browser',
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

  const renderTelegramNative = (): void => {
    if (state.activeNetwork !== 'telegram') {
      nativeTelegram.classList.add('hidden');
      return;
    }

    nativeTelegram.classList.remove('hidden');

    const telegramStatus = getStatusByNetwork('telegram');

    if (telegramStatus.authState !== 'authenticated') {
      telegramChatListEl.innerHTML = '<div class="telegram-empty">Telegram is not authenticated yet. Click Start Auth.</div>';
      telegramMessageListEl.innerHTML = `<div class="telegram-empty">${telegramStatus.details}</div>`;
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }

    if (state.telegramLoading && state.telegramChats.length < 1) {
      telegramChatListEl.innerHTML = '<div class="telegram-empty">Loading chats...</div>';
      telegramMessageListEl.innerHTML = '<div class="telegram-empty">Loading messages...</div>';
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }

    if (state.telegramChats.length < 1) {
      telegramChatListEl.innerHTML = '<div class="telegram-empty">No chats yet.</div>';
      telegramMessageListEl.innerHTML = '<div class="telegram-empty">No messages to display.</div>';
      telegramChatTitleEl.textContent = 'Telegram';
      return;
    }
    if (!state.selectedTelegramChatId) {
      state.selectedTelegramChatId = state.telegramChats[0].id;
    }

    const filteredTelegramChats = filterChatsByQuery(
      state.telegramChats,
      state.telegramSearchQuery,
    );

    if (filteredTelegramChats.length < 1) {
      telegramChatListEl.innerHTML = '<div class="telegram-empty">No chats match your search.</div>';
    } else {
      telegramChatListEl.replaceChildren(
        ...filteredTelegramChats.map((chat) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'telegram-chat-item';
        if (chat.id === state.activeTelegramChatId) {
          button.classList.add('active');
        }
        if (chat.id === state.selectedTelegramChatId && state.vimPane === 'telegram-chats') {
          button.classList.add('selected');
        }
        const avatar = createAvatarNode(chat.title, chat.avatarUrl, 'telegram-avatar');
        const content = document.createElement('div');
        content.className = 'telegram-chat-content';
        const name = document.createElement('div');
        name.className = 'telegram-chat-name';
        name.textContent = chat.title;
        const preview = document.createElement('div');
        preview.className = 'telegram-chat-preview';
        preview.textContent = chat.lastMessagePreview || 'No preview';
        content.replaceChildren(name, preview);
        button.replaceChildren(avatar, content);
        button.addEventListener('click', () => {
          state.selectedTelegramChatId = chat.id;
          state.replyingToMessageId = null;
          state.replyingToSender = null;
          state.pendingTelegramImageDataUrls = [];
          state.vimPane = 'telegram-chats';
          void loadTelegramMessages(chat.id, 0, true);
        });
        return button;
        }),
      );
    }
    telegramChatListEl
      .querySelector<HTMLElement>('.telegram-chat-item.selected')
      ?.scrollIntoView({ block: 'nearest' });

    const activeChat = state.telegramChats.find((chat) => chat.id === state.activeTelegramChatId);
    telegramChatTitleEl.textContent = activeChat?.title ?? 'Telegram';

    const hasTelegramMessages = state.telegramMessages.length > 0;
    if (!hasTelegramMessages) {
      telegramMessageListEl.innerHTML = '<div class="telegram-empty">No messages in this chat.</div>';
      lastRenderedTelegramChatId = state.activeTelegramChatId;
    } else {
      const wasNearBottom =
        telegramMessageListEl.scrollHeight - telegramMessageListEl.scrollTop - telegramMessageListEl.clientHeight < 84;
      const activeChatChanged = lastRenderedTelegramChatId !== state.activeTelegramChatId;

      telegramMessageListEl.replaceChildren(
        ...state.telegramMessages.map((message, index, messages) => {
        const item = document.createElement('article');
        item.className = 'telegram-message-item';
        item.classList.add(message.outgoing ? 'outgoing' : 'incoming');
        const previousMessage = index > 0 ? messages[index - 1] : null;
        const isContinuation =
          !!previousMessage &&
          previousMessage.sender === message.sender &&
          previousMessage.outgoing === message.outgoing;
        if (isContinuation) {
          item.classList.add('continuation');
        }
        if (
          message.id === state.selectedTelegramMessageId &&
          state.vimPane === 'telegram-messages'
        ) {
          item.classList.add('selected');
        }
        const header = document.createElement('div');
        header.className = 'telegram-message-header';
        const avatar = createAvatarNode(message.sender, message.senderAvatarUrl, 'telegram-avatar small');
        const meta = document.createElement('div');
        meta.className = 'telegram-message-meta';
        meta.textContent = message.outgoing ? 'You' : message.sender;
        const text = document.createElement('div');
        text.className = 'telegram-message-text';
        text.textContent = message.text || '[empty]';
        if (message.outgoing) {
          header.replaceChildren(meta);
        } else {
          header.replaceChildren(avatar, meta);
        }
        const bodyNodes: HTMLElement[] = [];
        if (!isContinuation) {
          bodyNodes.push(header);
        }
        if (message.replyToSender || message.replyToText) {
          const reply = document.createElement('div');
          reply.className = 'telegram-message-reply';
          const replySender = document.createElement('div');
          replySender.className = 'telegram-message-reply-sender';
          replySender.textContent = message.replyToSender ?? 'Reply';
          const replyText = document.createElement('div');
          replyText.className = 'telegram-message-reply-text';
          replyText.textContent = message.replyToText?.trim() || '[message]';
          reply.replaceChildren(replySender, replyText);
          bodyNodes.push(reply);
        }
        if (message.imageUrl) {
          const image = document.createElement('img');
          image.className = 'telegram-message-image';
          image.src = message.imageUrl;
          image.alt = 'Telegram image';
          image.loading = 'lazy';
          image.addEventListener('click', () => {
            openTelegramImagePreview(message.imageUrl as string);
          });
          bodyNodes.push(image);
        }
        if (message.animationUrl) {
          bodyNodes.push(
            createAnimatedMediaNode(
              message.animationUrl,
              message.animationMimeType,
              'telegram-message-animation',
              'Telegram animation',
            ),
          );
        }
        if (message.stickerUrl) {
          const sticker = document.createElement('img');
          sticker.className = 'telegram-message-sticker';
          sticker.src = message.stickerUrl;
          sticker.alt = message.stickerEmoji
            ? `Telegram sticker ${message.stickerEmoji}`
            : 'Telegram sticker';
          sticker.loading = 'lazy';
          if (message.stickerIsAnimated) {
            sticker.title = 'Animated sticker preview';
          }
          bodyNodes.push(sticker);
        }
        if (message.hasAudio || message.audioUrl) {
          const voiceNote = document.createElement('div');
          voiceNote.className = 'telegram-voice-note';
          const playButton = document.createElement('button');
          playButton.type = 'button';
          playButton.className = 'telegram-voice-play';
          const playIcon = document.createElement('span');
          playIcon.className = 'telegram-voice-play-icon telegram-voice-play-icon-play';
          playIcon.textContent = '▶';
          const pauseIcon = document.createElement('span');
          pauseIcon.className = 'telegram-voice-play-icon telegram-voice-play-icon-pause';
          pauseIcon.setAttribute('aria-hidden', 'true');
          playButton.replaceChildren(playIcon, pauseIcon);
          const wave = document.createElement('div');
          wave.className = 'telegram-voice-wave';
          const barHeights = buildVoiceBarHeights(message.id);
          for (const height of barHeights) {
            const bar = document.createElement('span');
            bar.style.height = `${height}%`;
            wave.append(bar);
          }
          const duration = document.createElement('div');
          duration.className = 'telegram-voice-duration';
          duration.textContent = formatDuration(message.audioDurationSeconds ?? 0);
          const audio = document.createElement('audio');
          audio.className = 'telegram-message-audio';
          audio.preload = 'none';
          let loading = false;

          const updatePlayState = (): void => {
            const isPlaying = !audio.paused && !audio.ended;
            playButton.classList.toggle('playing', isPlaying);
            voiceNote.classList.toggle('playing', isPlaying);
          };

          if (message.audioUrl) {
            const source = document.createElement('source');
            source.src = message.audioUrl;
            source.type = 'audio/ogg;codecs=opus';
            audio.replaceChildren(source);
          }

          const ensureAudioLoaded = async (): Promise<boolean> => {
            if (message.audioUrl) {
              return true;
            }
            if (loading || !state.activeTelegramChatId) {
              return false;
            }
            loading = true;
            playButton.disabled = true;
            voiceNote.classList.add('loading');
            const resolved = await window.pelec.resolveConnectorAudioUrl(
              'telegram',
              state.activeTelegramChatId,
              message.id,
            );
            loading = false;
            playButton.disabled = false;
            voiceNote.classList.remove('loading');
            if (!resolved) {
              duration.textContent = 'retry';
              return false;
            }
            message.audioUrl = resolved;
            const source = document.createElement('source');
            source.src = resolved;
            source.type = 'audio/ogg;codecs=opus';
            audio.replaceChildren(source);
            audio.load();
            return true;
          };

          playButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!message.audioUrl) {
              const loaded = await ensureAudioLoaded();
              if (!loaded) {
                return;
              }
            }
            if (!audio.paused && !audio.ended) {
              audio.pause();
              return;
            }
            void audio.play().catch(() => {
              // Keep control state if autoplay policy blocks immediate playback.
            });
          });

          audio.addEventListener('play', updatePlayState);
          audio.addEventListener('pause', updatePlayState);
          audio.addEventListener('ended', updatePlayState);
          audio.addEventListener('loadedmetadata', () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
              return;
            }
            duration.textContent = formatDuration(audio.duration);
          });

          voiceNote.replaceChildren(playButton, wave, duration);
          bodyNodes.push(voiceNote, audio);
        }
        const textTrimmed = message.text.trim().toLowerCase();
        const shouldRenderText =
          !!message.text.trim() &&
          !(message.animationUrl && textTrimmed === 'gif/animation') &&
          !(message.stickerUrl && (textTrimmed === 'sticker' || textTrimmed.startsWith('sticker '))) &&
          !((message.audioUrl || message.hasAudio) && textTrimmed === 'voice message');
        if (shouldRenderText) {
          bodyNodes.push(text);
        }
        const messageReactions = message.reactions ?? [];
        if (messageReactions.length > 0) {
          const reactions = document.createElement('div');
          reactions.className = 'telegram-message-reactions';
          reactions.replaceChildren(
            ...messageReactions.map((reaction) => {
              const chip = document.createElement('span');
              chip.className = 'telegram-message-reaction';
              if (reaction.chosen) {
                chip.classList.add('chosen');
              }
              const value = document.createElement('span');
              value.className = 'telegram-message-reaction-value';
              value.textContent = reaction.value;
              const count = document.createElement('span');
              count.className = 'telegram-message-reaction-count';
              count.textContent = String(reaction.count);
              chip.replaceChildren(value, count);
              return chip;
            }),
          );
          bodyNodes.push(reactions);
        }
        const footer = document.createElement('div');
        footer.className = 'telegram-message-footer';
        const time = document.createElement('span');
        time.className = 'telegram-message-time';
        time.textContent = formatMessageTime(message.timestamp);
        footer.append(time);
        if (message.outgoing) {
          const receipt = document.createElement('span');
          receipt.className = 'telegram-message-receipt';
          const tickSingle = document.createElement('span');
          tickSingle.className = 'telegram-message-tick';
          tickSingle.textContent = '✓';
          const tickDouble = document.createElement('span');
          tickDouble.className = 'telegram-message-tick';
          tickDouble.textContent = '✓';
          if (message.readByPeer) {
            receipt.classList.add('read');
            receipt.title = 'Read';
            receipt.append(tickSingle, tickDouble);
          } else {
            receipt.classList.add('sent');
            receipt.title = 'Sent';
            receipt.append(tickSingle);
          }
          footer.append(receipt);
        }
        bodyNodes.push(footer);
        item.replaceChildren(...bodyNodes);
        item.addEventListener('click', () => {
          state.vimPane = 'telegram-messages';
          state.selectedTelegramMessageId = message.id;
          render();
        });
        return item;
        }),
      );
      if (
        activeChatChanged ||
        telegramForceScrollBottom ||
        (wasNearBottom && state.vimPane !== 'telegram-messages')
      ) {
        scheduleTelegramScrollToBottom();
        telegramForceScrollBottom = false;
      }

      if (state.vimPane === 'telegram-messages') {
        telegramMessageListEl
          .querySelector<HTMLElement>('.telegram-message-item.selected')
          ?.scrollIntoView({ block: 'nearest' });
      }
    }
    if (state.pendingTelegramImageDataUrls.length > 0) {
      const thumbs = state.pendingTelegramImageDataUrls.map((dataUrl, index) => {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'telegram-compose-thumb-wrap';
        const preview = document.createElement('img');
        preview.className = 'telegram-compose-preview';
        preview.src = dataUrl;
        preview.alt = `Pasted image ${index + 1}`;
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'telegram-compose-thumb-remove';
        clearButton.textContent = '×';
        clearButton.addEventListener('click', () => {
          state.pendingTelegramImageDataUrls = state.pendingTelegramImageDataUrls.filter(
            (_value, itemIndex) => itemIndex !== index,
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
    telegramComposeInput.placeholder = state.replyingToMessageId
      ? `Reply to ${state.replyingToSender ?? 'message'}`
      : state.pendingTelegramImageDataUrls.length > 0
        ? 'Type a caption...'
        : 'Type your message here...';
    lastRenderedTelegramChatId = state.activeTelegramChatId;
  };

  const renderInstagramWeb = (): void => {
    if (state.activeNetwork !== 'instagram') {
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

    const selectedNetwork = getNetworkById(state.selectedNetwork);
    const activeNetwork = getNetworkById(state.activeNetwork);
    shellEl.classList.remove('telegram-focus');
    shellEl.classList.add('sidebar-collapsed');

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
      webview.classList.toggle('active', id === state.activeNetwork && !hiddenForNativeView);
      webview.style.pointerEvents =
        ((state.mode === 'insert') || id === 'instagram') &&
        id === state.activeNetwork &&
        !hiddenForNativeView
          ? 'auto'
          : 'none';
    }

    renderTelegramNative();
    renderInstagramWeb();

    let statusLine = `${selectedNetwork.name} selected | ${activeNetwork.name} active | ${state.mode} mode`;
    if (state.activeNetwork === 'telegram') {
      statusLine = `pane:${state.vimPane} | ${selectedNetwork.name} selected | ${activeNetwork.name} active | ${state.mode} mode`;
    } else if (state.activeNetwork === 'instagram') {
      const status = getStatusByNetwork('instagram');
      statusLine = `pane:web-app | ${selectedNetwork.name} selected | ${activeNetwork.name} active | ${status.authState} | ${status.lastError ?? status.details}`;
    }
    renderStatusLine(statusBar, statusLine);

    commandPalette.classList.toggle('hidden', !state.commandPaletteOpen);
    renderCommandPalette();
  };

  telegramSendButton.addEventListener('click', () => {
    void sendTelegramMessage();
  });

  telegramComposeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendTelegramMessage();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setMode('normal');
    }
  });

  telegramComposeInput.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items;
    if (!items || items.length < 1) {
      return;
    }
    const imageFiles = Array.from(items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (imageFiles.length < 1) {
      return;
    }
    event.preventDefault();
    void (async () => {
      const readAsDataUrl = (file: File): Promise<string | null> =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(typeof reader.result === 'string' ? reader.result : null);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });

      const results = await Promise.all(imageFiles.map((file) => readAsDataUrl(file)));
      const valid = results.filter((value): value is string => !!value);
      if (valid.length < 1) {
        statusBar.textContent = 'Failed to read pasted image.';
        return;
      }
      state.pendingTelegramImageDataUrls = [...state.pendingTelegramImageDataUrls, ...valid];
      statusBar.textContent =
        valid.length === 1
          ? 'Image pasted. Type a caption, then press send.'
          : `${valid.length} images pasted. Type a caption, then press send.`;
      setMode('insert');
      telegramComposeInput.focus();
      render();
    })();
  });

  quickFilter.addEventListener('input', () => render());

  telegramSearchInput.addEventListener('input', () => {
    state.telegramSearchQuery = telegramSearchInput.value;
    render();
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

  window.pelec.onForceNormalMode(() => {
    setMode('normal');
  });

  window.pelec.onConnectorUpdate((event: ConnectorUpdateEvent) => {
    if (event.network === 'telegram') {
      if (event.kind === 'status') {
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

      if (event.kind === 'chats') {
        scheduleTelegramChatsRefresh();
        return;
      }

      if (event.kind === 'messages') {
        if (event.chatId && state.activeTelegramChatId && event.chatId !== state.activeTelegramChatId) {
          scheduleTelegramChatsRefresh();
          return;
        }
        if (state.activeNetwork === 'telegram' && state.activeTelegramChatId) {
          scheduleTelegramMessagesRefresh(state.activeTelegramChatId);
        }
        scheduleTelegramChatsRefresh();
      }
      return;
    }

    if (event.network === 'instagram') {
      if (event.kind === 'status') {
        void refreshConnectorStatuses().then(() => {
          render();
        });
        return;
      }

      if (event.kind === 'chats') {
        scheduleInstagramChatsRefresh();
        if (state.activeNetwork === 'instagram') {
          render();
        }
        return;
      }

      if (event.kind === 'messages') {
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !telegramImageModal.classList.contains('hidden')) {
      event.preventDefault();
      closeTelegramImagePreview();
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
      } else if (state.activeNetwork === 'instagram') {
        const activeWebview = webviewMap.get('instagram');
        activeWebview?.reload();
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

  await refreshConnectorStatuses();
  await loadTelegramChats();
  await loadInstagramChats();
  render();
};

void boot();
