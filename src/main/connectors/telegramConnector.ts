import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type {
  AuthStartResult,
  AuthSubmission,
  ChatDocument,
  ChatReaction,
  ChatMessage,
  ChatSummary,
  Connector,
  ConnectorUpdateEvent,
  ConnectorStatus,
  ResolvedDocument,
} from '../../shared/connectors';
import type { NetworkDefinition } from '../../shared/types';

const importRuntimeModule = async (relativeToNodeModules: string): Promise<unknown> => {
  const candidates = [
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      '.vite',
      'node_modules',
      relativeToNodeModules,
    ),
    path.join(__dirname, '..', 'node_modules', relativeToNodeModules),
    path.join(process.cwd(), 'node_modules', relativeToNodeModules),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    return import(pathToFileURL(candidate).href);
  }

  throw new Error(`Runtime module not found: ${relativeToNodeModules}`);
};

const loadTdlModule = async (): Promise<{
  default?: {
    createClient?: (config: unknown) => TdClient;
    configure?: (config: { tdjson: string }) => void;
  };
  createClient?: (config: unknown) => TdClient;
  configure?: (config: { tdjson: string }) => void;
}> =>
  (await importRuntimeModule(path.join('tdl', 'dist', 'index.js'))) as {
    default?: {
      createClient?: (config: unknown) => TdClient;
      configure?: (config: { tdjson: string }) => void;
    };
    createClient?: (config: unknown) => TdClient;
    configure?: (config: { tdjson: string }) => void;
  };

const loadPrebuiltTdlibModule = async (): Promise<{ getTdjson?: () => string }> =>
  (await importRuntimeModule(path.join('prebuilt-tdlib', 'index.js'))) as {
    getTdjson?: () => string;
  };

type TdClient = {
  invoke: (request: Record<string, unknown>) => Promise<unknown>;
  on: (event: 'update' | 'error' | 'close', handler: (payload: unknown) => void) => void;
  close?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
};

type AuthorizationState = {
  _: string;
  link?: string;
};

type AuthorizationUpdate = {
  _: string;
  authorization_state?: AuthorizationState;
};

type TdMessage = {
  id?: number | string | bigint;
  date?: number;
  is_outgoing?: boolean;
  reply_to?: {
    message_id?: number | string | bigint;
  };
  reply_to_message_id?: number | string | bigint;
  sender_id?: { user_id?: number; chat_id?: number; _: string };
  interaction_info?: unknown;
  content?: unknown;
};

type TdChat = {
  id?: number;
  title?: string;
  type?: { _: string };
  unread_count?: number;
  last_message?: { content?: unknown };
  last_read_outbox_message_id?: number | string | bigint;
  notification_settings?: {
    use_default_mute_for?: boolean;
    mute_for?: number;
  };
};

type TdScopeNotificationSettings = {
  mute_for?: number;
};

type TdFileRef = {
  id?: number;
  size?: number;
  expected_size?: number;
  local?: { path?: string };
};

export class TelegramConnector implements Connector {
  private status: ConnectorStatus;
  private tdClient: TdClient | null = null;
  private tdLibReady = false;
  private latestQrLink: string | null = null;
  private activeChatId: string | null = null;
  private qrWaiters: Array<(link: string | null) => void> = [];
  private userLabelCache = new Map<number, string>();
  private userAvatarCache = new Map<number, string | undefined>();
  private chatTitleCache = new Map<number, string>();
  private chatAvatarCache = new Map<number, string | undefined>();
  private mediaDataUrlCache = new Map<string, string>();
  private uploadTempCleanupTimers = new Map<string, NodeJS.Timeout>();
  private updateListeners = new Set<(event: ConnectorUpdateEvent) => void>();

  constructor(
    private readonly network: NetworkDefinition,
    private readonly userDataPath: string,
  ) {
    this.status = {
      network: this.network.id,
      mode: 'native',
      authState: 'unauthenticated',
      capabilities: {
        qr: true,
        twoFactor: true,
        officialApi: false,
      },
      partition: this.network.partition,
      webUrl: this.network.homeUrl,
      details: 'Preparing Telegram TDLib connector.',
    };
  }

  async init(): Promise<void> {
    await this.tryInitTdlib();
  }

  async shutdown(): Promise<void> {
    const client = this.tdClient;
    this.tdClient = null;
    this.tdLibReady = false;
    this.latestQrLink = null;
    this.activeChatId = null;
    this.resolveQrWaiters(null);
    for (const timer of this.uploadTempCleanupTimers.values()) {
      clearTimeout(timer);
    }
    const tempDirs = [...this.uploadTempCleanupTimers.keys()];
    this.uploadTempCleanupTimers.clear();
    await Promise.allSettled(
      tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })),
    );

    if (!client) {
      return;
    }

    try {
      await client.invoke({ _: 'close' });
    } catch {
      // Best-effort close; some TDLib/tdl versions can already be closed.
    }

    try {
      await client.close?.();
    } catch {
      // Best-effort close hook.
    }

    try {
      await client.destroy?.();
    } catch {
      // Best-effort destroy hook.
    }
  }

  getStatus(): ConnectorStatus {
    return this.status;
  }

  onUpdate(handler: (event: ConnectorUpdateEvent) => void): () => void {
    this.updateListeners.add(handler);
    return () => {
      this.updateListeners.delete(handler);
    };
  }

  async startAuth(): Promise<AuthStartResult> {
    if (!this.tdLibReady || !this.tdClient) {
      return {
        network: this.network.id,
        mode: 'none',
        instructions:
          'TDLib is not ready. Install TDLib deps and set TELEGRAM_API_ID / TELEGRAM_API_HASH.',
      };
    }

    this.status.authState = 'authenticating';
    this.status.details = 'Requesting Telegram QR code from TDLib...';

    const previousQrLink = this.latestQrLink;
    await this.requestQrCodeAuthentication();
    const qrLink = await this.waitForQrLink(10000, previousQrLink);

    if (qrLink) {
      this.status.details =
        'QR ready. Scan it with Telegram mobile app. Enter 2FA password if prompted.';
      return {
        network: this.network.id,
        mode: 'qr',
        instructions:
          'Scan QR code with Telegram. If 2FA is enabled, enter your password next.',
        qrLink,
        requiresTwoFactor: true,
      };
    }

    return {
      network: this.network.id,
      mode: 'qr',
      instructions:
        'Waiting for QR from TDLib. Try again in a moment if QR is not visible yet.',
      requiresTwoFactor: true,
    };
  }

  async submitAuth(payload: AuthSubmission): Promise<ConnectorStatus> {
    if (!this.tdClient) {
      this.status.authState = 'degraded';
      this.status.details = 'TDLib client is unavailable.';
      return this.status;
    }

    if (payload.type !== 'password') {
      this.status.details = 'Only password submission is needed for QR-based Telegram auth.';
      return this.status;
    }

    const password = payload.value.trim();
    if (!password) {
      return this.status;
    }

    try {
      await this.tdClient.invoke({
        _: 'checkAuthenticationPassword',
        password,
      });
      this.status.details = 'Password submitted. Waiting for Telegram authorization to complete.';
      this.status.lastError = undefined;
    } catch (error) {
      this.status.authState = 'degraded';
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Telegram password error';
      this.status.details = `Telegram password failed: ${this.status.lastError}`;
    }

    return this.status;
  }

  async listChats(): Promise<ChatSummary[]> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return [];
    }
    const client = this.tdClient;

    try {
      for (let i = 0; i < 4; i += 1) {
        try {
          await client.invoke({
            _: 'loadChats',
            chat_list: { _: 'chatListMain' },
            limit: 100,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.toLowerCase().includes('already')) {
            break;
          }
        }
      }

      const chatsResult = (await this.tdClient.invoke({
        _: 'getChats',
        chat_list: { _: 'chatListMain' },
        limit: 120,
      })) as { chat_ids?: Array<number | string> };

      const chatIds = (chatsResult.chat_ids ?? []).slice(0, 80);
      const scopeMuteForByType = new Map<string, number>();
      const summaries = await Promise.all(
        chatIds.map(async (chatId) => {
          const chat = (await client.invoke({
            _: 'getChat',
            chat_id: Number(chatId),
          })) as TdChat;
          const isMuted = await this.isChatMuted(client, chat, scopeMuteForByType);

          return {
            id: String(chat.id ?? chatId),
            title: chat.title ?? 'Untitled chat',
            unreadCount: chat.unread_count ?? 0,
            lastMessagePreview: this.extractMessageText(chat.last_message?.content),
            avatarUrl: await this.resolveChatAvatar(client, Number(chat.id ?? chatId)),
            isMuted,
          } as ChatSummary;
        }),
      );

      return summaries;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown getChats error';
      this.status.details = `Failed loading Telegram chats: ${this.status.lastError}`;
      return [];
    }
  }

  async listMessages(chatId: string): Promise<ChatMessage[]> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return [];
    }

    const client = this.tdClient;

    try {
      await client.invoke({
        _: 'openChat',
        chat_id: Number(chatId),
      });
      const chat = (await client.invoke({
        _: 'getChat',
        chat_id: Number(chatId),
      })) as TdChat;
      const lastReadOutboxMessageId = chat.last_read_outbox_message_id;

      const pageLimit = 50;
      const maxPages = 4;
      let cursor: number | string | bigint = 0;
      const collected: TdMessage[] = [];

      for (let page = 0; page < maxPages; page += 1) {
        const history = (await client.invoke({
          _: 'getChatHistory',
          chat_id: Number(chatId),
          from_message_id: cursor,
          offset: cursor === 0 ? 0 : -1,
          limit: pageLimit,
          only_local: false,
        })) as { messages?: TdMessage[] };

        const messages = history.messages ?? [];
        if (messages.length < 1) {
          break;
        }

        collected.push(...messages);
        const oldestId = messages[messages.length - 1]?.id;

        if (!oldestId || String(oldestId) === String(cursor) || messages.length < pageLimit) {
          break;
        }

        cursor = oldestId;
      }

      const uniqueById = new Map<string, TdMessage>();
      for (const message of collected) {
        const id = String(message.id ?? '');
        if (!id || uniqueById.has(id)) {
          continue;
        }
        uniqueById.set(id, message);
      }

      const replyContextById = new Map<
        string,
        {
          sender: string;
          text: string;
        }
      >();

      const replyTargetIds = new Set<string>();
      for (const message of uniqueById.values()) {
        const replyTargetId = this.extractReplyTargetId(message);
        if (replyTargetId) {
          replyTargetIds.add(replyTargetId);
        }
      }

      for (const replyTargetId of replyTargetIds) {
        const localMessage = uniqueById.get(replyTargetId);
        if (localMessage) {
          replyContextById.set(replyTargetId, {
            sender: await this.resolveSenderLabel(client, localMessage.sender_id),
            text: this.extractMessageText(localMessage.content),
          });
          continue;
        }

        const remoteMessage = await this.loadMessageById(client, chatId, replyTargetId);
        if (!remoteMessage) {
          continue;
        }
        replyContextById.set(replyTargetId, {
          sender: await this.resolveSenderLabel(client, remoteMessage.sender_id),
          text: this.extractMessageText(remoteMessage.content),
        });
      }

      const parsed = await Promise.all(
        [...uniqueById.values()].map(async (message) => {
          const replyTargetId = this.extractReplyTargetId(message);
          const replyContext = replyTargetId ? replyContextById.get(replyTargetId) : undefined;
          return {
            id: String(message.id ?? ''),
            sender: await this.resolveSenderLabel(client, message.sender_id),
            text: this.extractMessageText(message.content),
            timestamp: (message.date ?? 0) * 1000,
            outgoing: Boolean(message.is_outgoing),
            readByPeer:
              message.is_outgoing === true
                ? this.isMessageReadByPeer(message.id, lastReadOutboxMessageId)
                : undefined,
            replyToMessageId: replyTargetId,
            replyToSender: replyContext?.sender,
            replyToText: replyContext?.text,
            hasAudio: this.hasVoiceNote(message.content),
            imageUrl: await this.extractImageUrl(client, message.content),
            animationUrl: await this.extractAnimationUrl(client, message.content),
            animationMimeType: this.extractAnimationMimeType(message.content),
            stickerUrl: await this.extractStickerUrl(client, message.content),
            stickerEmoji: this.extractStickerEmoji(message.content),
            stickerIsAnimated: this.isAnimatedSticker(message.content),
            reactions: this.extractReactions(message.interaction_info),
            audioDurationSeconds: this.extractVoiceDurationSeconds(message.content),
            senderAvatarUrl: await this.resolveSenderAvatar(client, message.sender_id),
            document: this.extractDocumentMetadata(message.content),
          };
        }),
      );

      return parsed.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return this.compareMessageIds(a.id, b.id);
      });
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown getChatHistory error';
      this.status.details = `Failed loading messages: ${this.status.lastError}`;
      return [];
    } finally {
      if (this.activeChatId !== chatId) {
        await this.closeChat(client, chatId);
      }
    }
  }

  async setActiveChat(chatId?: string | null): Promise<void> {
    const previousChatId = this.activeChatId;
    this.activeChatId = chatId?.trim() ? chatId : null;

    const client = this.tdClient;
    if (!client) {
      return;
    }

    if (previousChatId && previousChatId !== this.activeChatId) {
      await this.closeChat(client, previousChatId);
    }

    if (!this.activeChatId || this.status.authState !== 'authenticated') {
      return;
    }

    try {
      await client.invoke({
        _: 'openChat',
        chat_id: Number(this.activeChatId),
      });
    } catch {
      // Best-effort open; message loading still works without keeping the chat watched.
    }
  }

  async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const messageText = text.trim();
    if (!messageText) {
      return false;
    }

    try {
      const replyTo = this.toTdMessageId(replyToMessageId);
      const baseRequest = {
        _: 'sendMessage',
        chat_id: Number(chatId),
        input_message_content: {
          _: 'inputMessageText',
          text: {
            _: 'formattedText',
            text: messageText,
          },
        },
      } as Record<string, unknown>;

      if (replyTo) {
        try {
          await this.tdClient.invoke({
            ...baseRequest,
            reply_to: {
              _: 'inputMessageReplyToMessage',
              message_id: replyTo,
              quote: null,
              checklist_task_id: 0,
            },
          });
        } catch {
          // Backward-compatible fallback for TDLib versions expecting reply_to_message_id.
          await this.tdClient.invoke({
            ...baseRequest,
            reply_to_message_id: replyTo,
          });
        }
      } else {
        await this.tdClient.invoke(baseRequest);
      }
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown sendMessage error';
      this.status.details = `Failed sending message: ${this.status.lastError}`;
      return false;
    }
  }

  async sendImageMessage(
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const parsed = this.parseDataUrl(dataUrl);
    if (!parsed || !parsed.mimeType.startsWith('image/')) {
      return false;
    }

    let tempDir: string | null = null;
    let shouldCleanupImmediately = true;
    try {
      tempDir = await mkdtemp(path.join(os.tmpdir(), 'pelec-telegram-image-'));
      const ext = this.extensionFromMime(parsed.mimeType);
      const filePath = path.join(tempDir, `clipboard-image${ext}`);
      await writeFile(filePath, parsed.bytes);

      const baseRequest = {
        _: 'sendMessage',
        chat_id: Number(chatId),
        input_message_content: {
          _: 'inputMessagePhoto',
          photo: {
            _: 'inputFileLocal',
            path: filePath,
          },
          caption: {
            _: 'formattedText',
            text: caption?.trim() ?? '',
          },
        },
      } as Record<string, unknown>;

      const replyTo = this.toTdMessageId(replyToMessageId);
      if (replyTo) {
        try {
          await this.tdClient.invoke({
            ...baseRequest,
            reply_to: {
              _: 'inputMessageReplyToMessage',
              message_id: replyTo,
              quote: null,
              checklist_task_id: 0,
            },
          });
        } catch {
          await this.tdClient.invoke({
            ...baseRequest,
            reply_to_message_id: replyTo,
          });
        }
      } else {
        await this.tdClient.invoke(baseRequest);
      }

      shouldCleanupImmediately = false;
      this.scheduleUploadTempCleanup(tempDir);
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown sendImageMessage error';
      this.status.details = `Failed sending image: ${this.status.lastError}`;
      return false;
    } finally {
      if (tempDir && shouldCleanupImmediately) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {
          // Best-effort temp cleanup.
        });
      }
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const tdMessageId = this.toTdMessageId(messageId);
    if (!tdMessageId) {
      return false;
    }

    try {
      await this.tdClient.invoke({
        _: 'deleteMessages',
        chat_id: Number(chatId),
        message_ids: [tdMessageId],
        revoke: true,
      });
      return true;
    } catch (error) {
      try {
        await this.tdClient.invoke({
          _: 'deleteMessages',
          chat_id: Number(chatId),
          message_ids: [tdMessageId],
          revoke: false,
        });
        return true;
      } catch (fallbackError) {
        this.status.lastError =
          fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : 'Unknown deleteMessage error';
        this.status.details = `Failed deleting message: ${this.status.lastError}`;
        return false;
      }
    }
  }

  async resolveAudioUrl(chatId: string, messageId: string): Promise<string | undefined> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return undefined;
    }
    const tdMessageId = this.toTdMessageId(messageId);
    if (!tdMessageId) {
      return undefined;
    }
    try {
      const message = (await this.tdClient.invoke({
        _: 'getMessage',
        chat_id: Number(chatId),
        message_id: tdMessageId,
      })) as { content?: unknown };
      return this.extractVoiceNoteUrl(this.tdClient, message.content);
    } catch {
      return undefined;
    }
  }

  async resolveDocument(
    chatId: string,
    messageId: string,
  ): Promise<ResolvedDocument | undefined> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return undefined;
    }
    const tdMessageId = this.toTdMessageId(messageId);
    if (!tdMessageId) {
      return undefined;
    }

    try {
      const message = (await this.tdClient.invoke({
        _: 'getMessage',
        chat_id: Number(chatId),
        message_id: tdMessageId,
      })) as { content?: unknown };
      return this.extractResolvedDocument(this.tdClient, message.content);
    } catch {
      return undefined;
    }
  }

  private resolveQrWaiters(link: string | null): void {
    for (const resolve of this.qrWaiters) {
      resolve(link);
    }
    this.qrWaiters = [];
  }

  private toTdMessageId(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber) || asNumber <= 0) {
      return undefined;
    }
    return asNumber;
  }

  private waitForQrLink(timeoutMs: number, previousLink?: string | null): Promise<string | null> {
    if (this.latestQrLink && this.latestQrLink !== previousLink) {
      return Promise.resolve(this.latestQrLink);
    }

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.qrWaiters = this.qrWaiters.filter((entry) => entry !== wrappedResolve);
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (value: string | null) => {
        if (settled) {
          return;
        }
        if (value && value === previousLink) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };

      this.qrWaiters.push(wrappedResolve);
    });
  }

  private async requestQrCodeAuthentication(): Promise<void> {
    if (!this.tdClient) {
      return;
    }

    try {
      await this.tdClient.invoke({ _: 'requestQrCodeAuthentication' });
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown requestQrCodeAuthentication error';
      this.status.details =
        'TDLib could not request QR immediately. Waiting for authorization state update.';
    }
  }

  private handleAuthorizationState(state: AuthorizationState): void {
    if (state._ === 'authorizationStateWaitOtherDeviceConfirmation') {
      const link = typeof state.link === 'string' ? state.link : null;
      if (link) {
        this.latestQrLink = link;
        this.status.authState = 'authenticating';
        this.status.details =
          'QR generated. Scan with Telegram app. Enter password if 2FA is requested.';
        this.resolveQrWaiters(link);
      }
      return;
    }

    if (state._ === 'authorizationStateWaitPassword') {
      this.status.authState = 'authenticating';
      this.status.details = 'Telegram is asking for 2FA password.';
      return;
    }

    if (state._ === 'authorizationStateReady') {
      this.status.authState = 'authenticated';
      this.status.mode = 'native';
      this.status.details = 'Telegram authenticated with TDLib.';
      this.status.lastError = undefined;
      this.latestQrLink = null;
      return;
    }

    if (state._ === 'authorizationStateWaitPhoneNumber') {
      this.status.authState = 'authenticating';
      this.status.details = 'Requesting QR authentication from phone-number state...';
      void this.requestQrCodeAuthentication();
      return;
    }

    if (state._ === 'authorizationStateClosed') {
      this.status.authState = 'unauthenticated';
      this.status.details = 'TDLib authorization state is closed.';
      this.activeChatId = null;
    }
  }

  private async closeChat(client: TdClient, chatId: string): Promise<void> {
    try {
      await client.invoke({
        _: 'closeChat',
        chat_id: Number(chatId),
      });
    } catch {
      // Best-effort close; failure is non-fatal for message rendering.
    }
  }

  private async resolveSenderLabel(
    client: TdClient,
    sender:
      | {
          user_id?: number;
          chat_id?: number;
          _?: string;
        }
      | undefined,
  ): Promise<string> {
    if (!sender) {
      return 'Unknown';
    }
    if (sender.user_id) {
      return this.resolveUserLabel(client, sender.user_id);
    }
    if (sender.chat_id) {
      return this.resolveChatTitle(client, sender.chat_id);
    }
    return sender._ ?? 'Unknown';
  }

  private async resolveSenderAvatar(
    client: TdClient,
    sender:
      | {
          user_id?: number;
          chat_id?: number;
          _?: string;
        }
      | undefined,
  ): Promise<string | undefined> {
    if (!sender) {
      return undefined;
    }
    if (sender.user_id) {
      return this.resolveUserAvatar(client, sender.user_id);
    }
    if (sender.chat_id) {
      return this.resolveChatAvatar(client, sender.chat_id);
    }
    return undefined;
  }

  private async resolveUserLabel(client: TdClient, userId: number): Promise<string> {
    const cached = this.userLabelCache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      const user = (await client.invoke({
        _: 'getUser',
        user_id: userId,
      })) as {
        first_name?: string;
        last_name?: string;
        username?: string;
        usernames?: { active_usernames?: string[] };
      };

      const first = user.first_name?.trim() ?? '';
      const last = user.last_name?.trim() ?? '';
      const fullName = `${first} ${last}`.trim();
      const username =
        user.usernames?.active_usernames?.[0]?.trim() ??
        user.username?.trim() ??
        '';
      const fallback = `User ${userId}`;
      const label = fullName || fallback;
      const withUsername = username ? `${label} (@${username})` : label;
      this.userLabelCache.set(userId, withUsername);
      return withUsername;
    } catch {
      const fallback = `User ${userId}`;
      this.userLabelCache.set(userId, fallback);
      return fallback;
    }
  }

  private async resolveUserAvatar(client: TdClient, userId: number): Promise<string | undefined> {
    if (this.userAvatarCache.has(userId)) {
      return this.userAvatarCache.get(userId);
    }

    try {
      const user = (await client.invoke({
        _: 'getUser',
        user_id: userId,
      })) as { profile_photo?: { small?: { id?: number; local?: { path?: string } } } };
      const avatar = await this.resolveTdFileUrl(client, user.profile_photo?.small);
      this.userAvatarCache.set(userId, avatar);
      return avatar;
    } catch {
      this.userAvatarCache.set(userId, undefined);
      return undefined;
    }
  }

  private async resolveChatTitle(client: TdClient, chatId: number): Promise<string> {
    const cached = this.chatTitleCache.get(chatId);
    if (cached) {
      return cached;
    }

    try {
      const chat = (await client.invoke({
        _: 'getChat',
        chat_id: chatId,
      })) as { title?: string };
      const title = chat.title?.trim() || `Chat ${chatId}`;
      this.chatTitleCache.set(chatId, title);
      return title;
    } catch {
      const fallback = `Chat ${chatId}`;
      this.chatTitleCache.set(chatId, fallback);
      return fallback;
    }
  }

  private async resolveChatAvatar(client: TdClient, chatId: number): Promise<string | undefined> {
    if (this.chatAvatarCache.has(chatId)) {
      return this.chatAvatarCache.get(chatId);
    }

    try {
      const chat = (await client.invoke({
        _: 'getChat',
        chat_id: chatId,
      })) as { photo?: { small?: { id?: number; local?: { path?: string } } } };
      const avatar = await this.resolveTdFileUrl(client, chat.photo?.small);
      this.chatAvatarCache.set(chatId, avatar);
      return avatar;
    } catch {
      this.chatAvatarCache.set(chatId, undefined);
      return undefined;
    }
  }

  private compareMessageIds(a: string, b: string): number {
    try {
      const ai = BigInt(a);
      const bi = BigInt(b);
      if (ai < bi) {
        return -1;
      }
      if (ai > bi) {
        return 1;
      }
      return 0;
    } catch {
      return a.localeCompare(b);
    }
  }

  private isMessageReadByPeer(
    messageId: number | string | bigint | undefined,
    lastReadOutboxMessageId: number | string | bigint | undefined,
  ): boolean {
    if (
      messageId === undefined ||
      messageId === null ||
      lastReadOutboxMessageId === undefined ||
      lastReadOutboxMessageId === null
    ) {
      return false;
    }
    try {
      return BigInt(messageId) <= BigInt(lastReadOutboxMessageId);
    } catch {
      const current = Number(messageId);
      const lastRead = Number(lastReadOutboxMessageId);
      if (!Number.isFinite(current) || !Number.isFinite(lastRead)) {
        return false;
      }
      return current <= lastRead;
    }
  }

  private async extractImageUrl(client: TdClient, content: unknown): Promise<string | undefined> {
    if (!content || typeof content !== 'object') {
      return undefined;
    }

    const container = content as {
      _?: string;
      photo?: { sizes?: Array<{ photo?: { id?: number; local?: { path?: string } } }> };
      document?: {
        mime_type?: string;
        document?: { id?: number; local?: { path?: string } };
      };
    };

    if (container._ === 'messageDocument') {
      const mime = container.document?.mime_type?.toLowerCase() ?? '';
      if (!mime.startsWith('image/')) {
        return undefined;
      }
      return this.resolveTdFileUrl(client, container.document?.document, mime);
    }

    if (container._ !== 'messagePhoto') {
      return undefined;
    }

    const sizes = container.photo?.sizes ?? [];
    if (sizes.length < 1) {
      return undefined;
    }

    for (let i = sizes.length - 1; i >= 0; i -= 1) {
      const candidate = sizes[i];
      const localPath = candidate.photo?.local?.path?.trim();
      if (localPath) {
        return this.localPathToDataUrl(localPath);
      }
    }

    const fileId = sizes[sizes.length - 1]?.photo?.id;
    if (!fileId) {
      return undefined;
    }

    try {
      const downloaded = (await client.invoke({
        _: 'downloadFile',
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true,
      })) as { local?: { path?: string } };
      const downloadedPath = downloaded.local?.path?.trim();
      if (!downloadedPath) {
        return undefined;
      }
      return this.localPathToDataUrl(downloadedPath);
    } catch {
      return undefined;
    }
  }

  private async extractStickerUrl(
    client: TdClient,
    content: unknown,
  ): Promise<string | undefined> {
    if (!content || typeof content !== 'object') {
      return undefined;
    }

    const container = content as {
      _?: string;
      sticker?: {
        sticker?: { id?: number; local?: { path?: string } };
        thumbnail?: { file?: { id?: number; local?: { path?: string } } };
        format?: { _?: string };
      };
    };

    if (container._ !== 'messageSticker') {
      return undefined;
    }

    const format = container.sticker?.format?._;
    if (format === 'stickerFormatTgs' || format === 'stickerFormatWebm') {
      return this.resolveTdFileUrl(client, container.sticker?.thumbnail?.file, 'image/jpeg');
    }

    return this.resolveTdFileUrl(client, container.sticker?.sticker, 'image/webp');
  }

  private async extractAnimationUrl(
    client: TdClient,
    content: unknown,
  ): Promise<string | undefined> {
    if (!content || typeof content !== 'object') {
      return undefined;
    }

    const container = content as {
      _?: string;
      animation?: {
        mime_type?: string;
        animation?: { id?: number; local?: { path?: string } };
      };
    };

    if (container._ !== 'messageAnimation') {
      return undefined;
    }

    return this.resolveTdFileUrl(
      client,
      container.animation?.animation,
      container.animation?.mime_type?.toLowerCase() ?? 'video/mp4',
    );
  }

  private async extractVoiceNoteUrl(client: TdClient, content: unknown): Promise<string | undefined> {
    if (!content || typeof content !== 'object') {
      return undefined;
    }

    const container = content as {
      _?: string;
      voice_note?: { voice?: { id?: number; local?: { path?: string } } };
    };

    if (container._ !== 'messageVoiceNote') {
      return undefined;
    }

    return this.resolveTdFileUrl(client, container.voice_note?.voice, 'audio/ogg;codecs=opus');
  }

  private extractDocumentMetadata(content: unknown): ChatDocument | undefined {
    const document = this.getTelegramDocument(content);
    if (!document) {
      return undefined;
    }

    return {
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  }

  private async extractResolvedDocument(
    client: TdClient,
    content: unknown,
  ): Promise<ResolvedDocument | undefined> {
    const document = this.getTelegramDocument(content);
    if (!document) {
      return undefined;
    }

    const filePath = await this.resolveTdFilePath(client, document.file);
    if (!filePath) {
      return undefined;
    }

    return {
      filePath,
      fileName:
        document.fileName && document.fileName !== 'Document'
          ? document.fileName
          : path.basename(filePath),
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  }

  private getTelegramDocument(
    content: unknown,
  ):
    | {
        file: TdFileRef | undefined;
        fileName: string;
        mimeType?: string;
        sizeBytes?: number;
      }
    | undefined {
    if (!content || typeof content !== 'object') {
      return undefined;
    }

    const container = content as {
      _?: string;
      document?: {
        file_name?: string;
        mime_type?: string;
        document?: TdFileRef;
      };
    };

    if (container._ !== 'messageDocument') {
      return undefined;
    }

    const mimeType = container.document?.mime_type?.trim().toLowerCase() || undefined;
    if (mimeType?.startsWith('image/')) {
      return undefined;
    }

    const file = container.document?.document;
    const fileName = container.document?.file_name?.trim() || 'Document';
    const rawSize = Number(file?.size ?? file?.expected_size ?? 0);
    const sizeBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : undefined;

    return {
      file,
      fileName,
      mimeType,
      sizeBytes,
    };
  }

  private extractVoiceDurationSeconds(content: unknown): number | undefined {
    if (!content || typeof content !== 'object') {
      return undefined;
    }
    const container = content as {
      _?: string;
      voice_note?: { duration?: number };
    };
    if (container._ !== 'messageVoiceNote') {
      return undefined;
    }
    const duration = container.voice_note?.duration;
    if (!duration || duration < 1) {
      return undefined;
    }
    return Math.floor(duration);
  }

  private hasVoiceNote(content: unknown): boolean {
    if (!content || typeof content !== 'object') {
      return false;
    }
    const container = content as { _?: string };
    return container._ === 'messageVoiceNote';
  }

  private extractAnimationMimeType(content: unknown): string | undefined {
    if (!content || typeof content !== 'object') {
      return undefined;
    }
    const container = content as {
      _?: string;
      animation?: { mime_type?: string };
    };
    if (container._ !== 'messageAnimation') {
      return undefined;
    }
    return container.animation?.mime_type?.trim().toLowerCase() || undefined;
  }

  private extractStickerEmoji(content: unknown): string | undefined {
    if (!content || typeof content !== 'object') {
      return undefined;
    }
    const container = content as { _?: string; emoji?: string };
    if (container._ !== 'messageSticker') {
      return undefined;
    }
    const emoji = container.emoji?.trim();
    return emoji || undefined;
  }

  private isAnimatedSticker(content: unknown): boolean {
    if (!content || typeof content !== 'object') {
      return false;
    }
    const container = content as {
      _?: string;
      sticker?: { format?: { _?: string } };
    };
    if (container._ !== 'messageSticker') {
      return false;
    }
    const format = container.sticker?.format?._;
    return format === 'stickerFormatTgs' || format === 'stickerFormatWebm';
  }

  private extractReactions(interactionInfo: unknown): ChatReaction[] | undefined {
    if (!interactionInfo || typeof interactionInfo !== 'object') {
      return undefined;
    }

    const container = interactionInfo as {
      reactions?: {
        reactions?: Array<{
          type?: {
            _?: string;
            emoji?: string;
          };
          total_count?: number;
          is_chosen?: boolean;
        }>;
      };
    };

    const reactions = (container.reactions?.reactions ?? [])
      .map((reaction) => {
        const type = reaction.type?._;
        const value =
          type === 'reactionTypeEmoji'
            ? reaction.type?.emoji?.trim()
            : type === 'reactionTypeCustomEmoji'
              ? 'Custom'
              : type === 'reactionTypePaid'
                ? 'Paid'
                : undefined;
        const count = Number(reaction.total_count ?? 0);
        if (!value || count < 1) {
          return undefined;
        }
        return {
          value,
          count,
          chosen: reaction.is_chosen === true || undefined,
        };
      })
      .filter((reaction): reaction is ChatReaction => !!reaction);

    return reactions.length > 0 ? reactions : undefined;
  }

  private async resolveTdFileUrl(
    client: TdClient,
    file: TdFileRef | undefined,
    preferredMimeType?: string,
  ): Promise<string | undefined> {
    const localPath = await this.resolveTdFilePath(client, file);
    if (!localPath) {
      return undefined;
    }

    return this.localPathToDataUrl(localPath, preferredMimeType);
  }

  private async resolveTdFilePath(
    client: TdClient,
    file: TdFileRef | undefined,
  ): Promise<string | undefined> {
    const localPath = file?.local?.path?.trim();
    if (localPath) {
      return localPath;
    }

    const fileId = file?.id;
    if (!fileId) {
      return undefined;
    }

    try {
      const downloaded = (await client.invoke({
        _: 'downloadFile',
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true,
      })) as { local?: { path?: string } };
      return downloaded.local?.path?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async localPathToDataUrl(
    localPath: string,
    preferredMimeType?: string,
  ): Promise<string | undefined> {
    const cached = this.mediaDataUrlCache.get(localPath);
    if (cached) {
      return cached;
    }

    try {
      const bytes = await readFile(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mimeType =
        preferredMimeType ??
        (ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.ogg' || ext === '.oga' || ext === '.opus'
                ? 'audio/ogg;codecs=opus'
                : ext === '.mp3'
                  ? 'audio/mpeg'
                  : ext === '.m4a'
                    ? 'audio/mp4'
                    : ext === '.aac'
                      ? 'audio/aac'
                      : ext === '.wav'
                        ? 'audio/wav'
                        : ext === '.webm'
                          ? 'audio/webm'
                          : 'image/jpeg');
      const value = `data:${mimeType};base64,${bytes.toString('base64')}`;
      this.mediaDataUrlCache.set(localPath, value);
      return value;
    } catch {
      return undefined;
    }
  }

  private extractReplyTargetId(message: TdMessage): string | undefined {
    const id = message.reply_to?.message_id ?? message.reply_to_message_id;
    if (id === undefined || id === null) {
      return undefined;
    }
    const value = String(id).trim();
    if (!value || value === '0') {
      return undefined;
    }
    return value;
  }

  private async loadMessageById(
    client: TdClient,
    chatId: string,
    messageId: string,
  ): Promise<TdMessage | undefined> {
    const tdMessageId = this.toTdMessageId(messageId);
    if (!tdMessageId) {
      return undefined;
    }
    try {
      return (await client.invoke({
        _: 'getMessage',
        chat_id: Number(chatId),
        message_id: tdMessageId,
      })) as TdMessage;
    } catch {
      return undefined;
    }
  }

  private parseDataUrl(
    dataUrl: string,
  ): { mimeType: string; bytes: Buffer } | undefined {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl.trim());
    if (!match) {
      return undefined;
    }
    const mimeType = match[1]?.toLowerCase() ?? '';
    const base64 = match[2] ?? '';
    if (!mimeType || !base64) {
      return undefined;
    }
    try {
      return {
        mimeType,
        bytes: Buffer.from(base64, 'base64'),
      };
    } catch {
      return undefined;
    }
  }

  private extensionFromMime(mimeType: string): string {
    if (mimeType === 'image/png') {
      return '.png';
    }
    if (mimeType === 'image/webp') {
      return '.webp';
    }
    if (mimeType === 'image/gif') {
      return '.gif';
    }
    if (mimeType === 'image/bmp') {
      return '.bmp';
    }
    return '.jpg';
  }

  private scheduleUploadTempCleanup(tempDir: string): void {
    const existing = this.uploadTempCleanupTimers.get(tempDir);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.uploadTempCleanupTimers.delete(tempDir);
      void rm(tempDir, { recursive: true, force: true }).catch(() => {
        // Best-effort temp cleanup.
      });
    }, 5 * 60 * 1000);
    timer.unref?.();
    this.uploadTempCleanupTimers.set(tempDir, timer);
  }

  private extractMessageText(content: unknown): string {
    if (!content || typeof content !== 'object') {
      return '';
    }
    const container = content as {
      _: string;
      text?: { text?: string };
      caption?: { text?: string };
      emoji?: string;
      title?: string;
      performer?: string;
      file_name?: string;
      contact?: { first_name?: string; last_name?: string; phone_number?: string };
      location?: { latitude?: number; longitude?: number };
    };

    if (container.text?.text) {
      return container.text.text;
    }
    if (container.caption?.text) {
      return container.caption.text;
    }

    if (container._ === 'messageSticker') {
      return container.emoji ? `Sticker ${container.emoji}` : 'Sticker';
    }
    if (container._ === 'messageAnimatedEmoji') {
      return container.emoji ? `Animated emoji ${container.emoji}` : 'Animated emoji';
    }
    if (container._ === 'messageVoiceNote') {
      return 'Voice message';
    }
    if (container._ === 'messageVideoNote') {
      return 'Video message';
    }
    if (container._ === 'messagePhoto') {
      return 'Photo';
    }
    if (container._ === 'messageVideo') {
      return 'Video';
    }
    if (container._ === 'messageAnimation') {
      return 'GIF/Animation';
    }
    if (container._ === 'messageAudio') {
      const title = container.title?.trim();
      const performer = container.performer?.trim();
      if (title && performer) {
        return `Audio: ${performer} - ${title}`;
      }
      if (title) {
        return `Audio: ${title}`;
      }
      return 'Audio file';
    }
    if (container._ === 'messageDocument') {
      return container.file_name ? `Document: ${container.file_name}` : 'Document';
    }
    if (container._ === 'messageContact') {
      const firstName = container.contact?.first_name?.trim() ?? '';
      const lastName = container.contact?.last_name?.trim() ?? '';
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName) {
        return `Contact: ${fullName}`;
      }
      return container.contact?.phone_number
        ? `Contact: ${container.contact.phone_number}`
        : 'Contact';
    }
    if (container._ === 'messageLocation') {
      const lat = container.location?.latitude;
      const lon = container.location?.longitude;
      if (typeof lat === 'number' && typeof lon === 'number') {
        return `Location: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
      return 'Location';
    }
    if (container._ === 'messageCall') {
      return 'Call';
    }
    if (container._ === 'messageChatAddMembers') {
      return 'Members added';
    }
    if (container._ === 'messageChatDeleteMember') {
      return 'Member removed';
    }
    if (container._ === 'messageChatJoinByLink') {
      return 'Joined via invite link';
    }
    if (container._ === 'messageChatJoinByRequest') {
      return 'Join request approved';
    }
    if (container._ === 'messageChatChangeTitle') {
      return 'Group title changed';
    }
    if (container._ === 'messagePinMessage') {
      return 'Pinned a message';
    }
    if (container._ === 'messagePoll') {
      return 'Poll';
    }

    return `[${container._ ?? 'message'}]`;
  }

  private async tryInitTdlib(): Promise<void> {
    const apiIdRaw = process.env.TELEGRAM_API_ID;
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!apiIdRaw || !apiHash) {
      this.tdLibReady = false;
      this.status.authState = 'degraded';
      this.status.details =
        'Missing TELEGRAM_API_ID / TELEGRAM_API_HASH. TDLib cannot start.';
      return;
    }

    try {
      const apiId = Number.parseInt(apiIdRaw, 10);
      if (!Number.isFinite(apiId) || apiId <= 0) {
        throw new Error('Invalid TELEGRAM_API_ID');
      }

      const tdlModule = await loadTdlModule();
      const tdl = tdlModule.default ?? tdlModule;

      if (!tdl?.createClient) {
        throw new Error('tdl createClient export not found');
      }

      let tdjsonPath: string | undefined;
      const packagedCandidates = [
        path.join(process.resourcesPath, 'libtdjson.so'),
        path.join(process.resourcesPath, 'tdlib', 'libtdjson.so'),
        path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          '.vite',
          'node_modules',
          '@prebuilt-tdlib',
          'linux-x64-glibc',
          'libtdjson.so',
        ),
      ];
      tdjsonPath = packagedCandidates.find((candidate) => existsSync(candidate));

      if (!tdjsonPath) {
        try {
          const prebuiltTdlib = await loadPrebuiltTdlibModule();
          const resolved = prebuiltTdlib.getTdjson?.();
          if (resolved && existsSync(resolved)) {
            tdjsonPath = resolved;
          }
        } catch {
          tdjsonPath = undefined;
        }
      }

      if (tdjsonPath && tdl.configure) {
        tdl.configure({ tdjson: tdjsonPath });
      }

      if (!tdjsonPath) {
        throw new Error('No TDLib shared library found from prebuilt-tdlib.');
      }

      const clientConfig: Record<string, unknown> = {
        apiId,
        apiHash,
        tdlibParameters: {
          use_message_database: true,
          use_secret_chats: false,
          system_language_code: 'en',
          device_model: 'pelec-electron',
          system_version: process.platform,
          application_version: '1.0.0',
        },
        databaseDirectory: path.join(this.userDataPath, 'tdlib', 'telegram'),
        filesDirectory: path.join(this.userDataPath, 'tdlib-files', 'telegram'),
      };

      this.tdClient = tdl.createClient(clientConfig) as TdClient;

      this.tdClient.on('update', (payload: unknown) => {
        const update = payload as AuthorizationUpdate & {
          chat_id?: number;
          message?: { chat_id?: number };
        };
        if (update._ === 'updateAuthorizationState' && update.authorization_state) {
          this.handleAuthorizationState(update.authorization_state);
          this.emitUpdate({ network: this.network.id, kind: 'status' });
          return;
        }

        if (update._ === 'updateNewMessage' || update._ === 'updateMessageContent') {
          const chatId = update.chat_id ?? update.message?.chat_id;
          this.emitUpdate({
            network: this.network.id,
            kind: 'messages',
            chatId: typeof chatId === 'number' ? String(chatId) : undefined,
          });
          this.emitUpdate({ network: this.network.id, kind: 'chats' });
          return;
        }

        if (
          update._ === 'updateDeleteMessages' ||
          update._ === 'updateMessageEdited' ||
          update._ === 'updateMessageSendSucceeded' ||
          update._ === 'updateMessageSendFailed' ||
          update._ === 'updateChatReadOutbox'
        ) {
          this.emitUpdate({
            network: this.network.id,
            kind: 'messages',
            chatId: typeof update.chat_id === 'number' ? String(update.chat_id) : undefined,
          });
          return;
        }

        if (
          update._ === 'updateChatLastMessage' ||
          update._ === 'updateChatPosition' ||
          update._ === 'updateChatTitle' ||
          update._ === 'updateChatPhoto' ||
          update._ === 'updateChatReadInbox' ||
          update._ === 'updateChatDraftMessage'
        ) {
          this.emitUpdate({ network: this.network.id, kind: 'chats' });
        }
      });

      this.tdClient.on('error', (payload: unknown) => {
        const message = payload instanceof Error ? payload.message : String(payload);
        this.status.authState = 'degraded';
        this.status.lastError = message;
        this.status.details = `TDLib runtime error: ${message}`;
      });

      this.tdLibReady = true;
      this.status.mode = 'native';
      this.status.authState = 'unauthenticated';
      this.status.details = 'TDLib initialized. Start auth to open QR login.';
      this.status.lastError = undefined;
    } catch (error) {
      this.tdLibReady = false;
      this.tdClient = null;
      this.status.mode = 'native';
      this.status.authState = 'degraded';
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown TDLib initialization error';
      this.status.details = `TDLib initialization failed: ${this.status.lastError}`;
    }
  }

  private emitUpdate(event: ConnectorUpdateEvent): void {
    for (const listener of this.updateListeners) {
      listener(event);
    }
  }

  private async isChatMuted(
    client: TdClient,
    chat: TdChat,
    scopeMuteForByType: Map<string, number>,
  ): Promise<boolean> {
    const chatMuteFor = chat.notification_settings?.mute_for ?? 0;
    if (chat.notification_settings?.use_default_mute_for === false) {
      return chatMuteFor > 0;
    }

    const scope = this.getNotificationSettingsScope(chat);
    if (!scope) {
      return chatMuteFor > 0;
    }

    if (scopeMuteForByType.has(scope)) {
      return (scopeMuteForByType.get(scope) ?? 0) > 0;
    }

    try {
      const settings = (await client.invoke({
        _: 'getScopeNotificationSettings',
        scope: { _: scope },
      })) as TdScopeNotificationSettings;
      const muteFor = settings.mute_for ?? 0;
      scopeMuteForByType.set(scope, muteFor);
      return muteFor > 0;
    } catch {
      return chatMuteFor > 0;
    }
  }

  private getNotificationSettingsScope(chat: TdChat): string | null {
    const chatType = chat.type?._;
    if (chatType === 'chatTypePrivate' || chatType === 'chatTypeSecret') {
      return 'notificationSettingsScopePrivateChats';
    }
    if (chatType === 'chatTypeBasicGroup' || chatType === 'chatTypeSupergroup') {
      return 'notificationSettingsScopeGroupChats';
    }
    return null;
  }
}
