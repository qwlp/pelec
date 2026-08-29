import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type {
  AuthStartResult,
  AuthSubmission,
  ChatDocument,
  ChatMessage,
  ChatSummary,
  Connector,
  ConnectorProfile,
  ConnectorProfileUpdate,
  ConnectorUpdateEvent,
  ConnectorStatus,
  ListMessagesOptions,
  OutgoingAttachmentDocument,
  ResolvedDocument,
  TelegramPickerItem,
  TelegramPickerQuery,
  TelegramCallDevice,
  TelegramCallState,
  TelegramCallUpdate,
  TelegramCallVideoFrame,
  TelegramStickerSetSource,
  TelegramStickerSetSummary,
} from '../../shared/connectors';
import type { NetworkDefinition, NetworkId, TelegramUserConfig } from '../../shared/types';
import {
  buildTelegramChatPreview,
  extractTelegramCallInfo,
  extractTelegramMessageEntities,
  extractTelegramServiceEvent,
  extractTelegramMessageText,
  extractTelegramPollInfo,
  extractTelegramReactions,
} from './telegram/messages';
import {
  resolveTdFilePath,
  resolveTdFileUrl,
  resolveTdPlayableFilePath,
} from './telegram/files';
import {
  buildTelegramLocalMediaUrl,
  extractTelegramAnimationMimeType,
  extractTelegramAnimationSource,
  extractTelegramDocumentMetadata,
  extractTelegramImageDocumentSource,
  extractTelegramImageName,
  getTelegramFileSizeBytes,
  getTelegramImageFile,
  extractTelegramPhotoFiles,
  extractTelegramStickerEmoji,
  extractTelegramStickerSource,
  extractTelegramVideoDimensions,
  extractTelegramVideoFile,
  extractTelegramVideoMimeType,
  extractTelegramVideoThumbnailFile,
  extractTelegramVoiceDurationSeconds,
  extractTelegramVoiceNoteFile,
  getTelegramDocument,
  getTelegramAnimationPreviewFile,
  hasTelegramVideo,
  hasTelegramVoiceNote,
  isTelegramAnimatedSticker,
  getTelegramStickerPreviewFile,
  inferTelegramLocalMimeType,
  mapTelegramAnimationToPickerItem,
  mapTelegramStickerToPickerItem,
} from './telegram/media';
import {
  getFfmpegBinaryPath,
  getFfprobeBinaryPath,
  loadPrebuiltTdlibModule,
  loadTdlModule,
} from './telegram/runtime';
import {
  isSupportedVoiceNoteMimeType,
  parseDataUrl,
  resolveUploadFileName,
  TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES,
} from './telegram/uploads';
import { TelegramCallService } from './telegram/callService';
import type {
  AuthorizationState,
  TdBasicGroup,
  PreparedUploadFile,
  PreparedVoiceNoteUpload,
  TdChat,
  TdClient,
  TdChatMemberStatus,
  TdAnimation,
  TdFileRef,
  TdMessage,
  TdScopeNotificationSettings,
  TdSticker,
  TdSupergroup,
  TdUpdateWithChatContext,
} from './telegram/types';

const TELEGRAM_TDLIB_REQUEST_TIMEOUT_MS = 8000;
const TELEGRAM_TDLIB_CHAT_SWITCH_TIMEOUT_MS = 2500;
const TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS = 60000;
const TELEGRAM_TDLIB_DOWNLOAD_POLL_INTERVAL_MS = 250;

const PELEC_MEDIA_SCHEME = 'pelec-media';

type LegacyConnectorUpdateEvent =
  | { network: NetworkId; kind: 'status' }
  | { network: NetworkId; kind: 'chats'; chatId?: string }
  | { network: NetworkId; kind: 'messages'; chatId?: string };

type TdStickerSet = {
  id?: number | string;
  title?: string;
  name?: string;
  thumbnail?: { file?: TdFileRef };
  stickers?: TdSticker[];
};

export class TelegramConnector implements Connector {
  private status: ConnectorStatus;
  private tdClient: TdClient | null = null;
  private tdLibReady = false;
  private isShuttingDown = false;
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
  private tdlibInitPromise: Promise<void> | null = null;
  private tdlibRecoveryPromise: Promise<void> | null = null;
  private ownUserId: number | null = null;
  private readonly callService: TelegramCallService;
  private readonly callCapabilityCache = new Map<
    number,
    { callable: boolean; supportsVideo: boolean }
  >();

  constructor(
    private readonly network: NetworkDefinition,
    private readonly userDataPath: string,
    private readonly userConfig: TelegramUserConfig,
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
      qrLink: null,
    };
    this.callService = new TelegramCallService({
      config: this.userConfig.calls,
      getClient: () => this.tdClient,
      invoke: async <T>(request: Record<string, unknown>, label: string) => {
        const client = this.tdClient;
        if (!client) {
          throw new Error('TDLib client is unavailable.');
        }
        return this.invokeWithTimeout<T>(client, request, label);
      },
      resolveUserLabel: async (userId) => {
        const client = this.tdClient;
        if (!client) {
          return `User ${userId}`;
        }
        return this.resolveUserLabel(client, userId);
      },
    });
  }

  async init(): Promise<void> {
    this.isShuttingDown = false;
    await this.initTdlib();
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.tdlibRecoveryPromise = null;
    const client = this.tdClient;
    this.tdClient = null;
    this.tdLibReady = false;
    this.latestQrLink = null;
    this.activeChatId = null;
    this.ownUserId = null;
    this.resolveQrWaiters(null);
    for (const timer of this.uploadTempCleanupTimers.values()) {
      clearTimeout(timer);
    }
    const tempDirs = [...this.uploadTempCleanupTimers.keys()];
    this.uploadTempCleanupTimers.clear();
    await this.callService.shutdown();
    await Promise.allSettled(
      tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })),
    );
    await this.disposeTdClient(client);
  }

  getStatus(): ConnectorStatus {
    return this.status;
  }

  private async invokeWithTimeout<T>(
    client: TdClient,
    request: Record<string, unknown>,
    label: string,
    timeoutMs = TELEGRAM_TDLIB_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      return await Promise.race([
        client.invoke(request) as Promise<T>,
        new Promise<T>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`TDLib ${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  onUpdate(handler: (event: ConnectorUpdateEvent) => void): () => void {
    this.updateListeners.add(handler);
    return () => {
      this.updateListeners.delete(handler);
    };
  }

  onTelegramCallUpdate(handler: (event: TelegramCallUpdate) => void): () => void {
    return this.callService.onUpdate(handler);
  }

  onTelegramCallVideoFrame(handler: (frame: TelegramCallVideoFrame) => void): () => void {
    return this.callService.onVideoFrame(handler);
  }

  async getTelegramCallState(): Promise<TelegramCallState> {
    return this.callService.getState();
  }

  async startTelegramCall(chatId: string, isVideo: boolean): Promise<TelegramCallState> {
    return this.callService.startPrivateCall(chatId, isVideo);
  }

  async answerTelegramCall(isVideo: boolean): Promise<TelegramCallState> {
    return this.callService.answerPrivateCall(isVideo);
  }

  async declineTelegramCall(): Promise<TelegramCallState> {
    return this.callService.decline();
  }

  async hangUpTelegramCall(): Promise<TelegramCallState> {
    return this.callService.hangUp();
  }

  async joinTelegramGroupCall(chatId: string, isVideo: boolean): Promise<TelegramCallState> {
    return this.callService.joinGroupCall(chatId, isVideo);
  }

  async leaveTelegramGroupCall(): Promise<TelegramCallState> {
    return this.callService.leaveGroupCall();
  }

  async setTelegramCallMuted(muted: boolean): Promise<TelegramCallState> {
    return this.callService.setMuted(muted);
  }

  async setTelegramCallVideoEnabled(enabled: boolean): Promise<TelegramCallState> {
    return this.callService.setVideoEnabled(enabled);
  }

  async setTelegramCallDevice(
    kind: TelegramCallDevice['kind'],
    deviceId: string,
  ): Promise<TelegramCallState> {
    return this.callService.setDevice(kind, deviceId);
  }

  async setTelegramParticipantVolume(
    participantId: string,
    volume: number,
  ): Promise<TelegramCallState> {
    return this.callService.setParticipantVolume(participantId, volume);
  }

  async setTelegramVisibleVideoEndpoints(endpointIds: string[]): Promise<void> {
    this.callService.setVisibleVideoEndpoints(endpointIds);
  }

  async startAuth(): Promise<AuthStartResult> {
    if (this.tdlibRecoveryPromise) {
      await this.tdlibRecoveryPromise;
    }

    if (!this.tdLibReady || !this.tdClient) {
      await this.initTdlib();
    }

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
    this.status.qrLink = this.latestQrLink;

    await this.requestQrCodeAuthentication();
    const qrLink = this.latestQrLink;

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
        'Waiting for QR from TDLib. It will appear as soon as Telegram returns it.',
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

  async resetAuth(): Promise<ConnectorStatus> {
    await this.callService.shutdown();
    if (!this.tdClient) {
      this.status.authState = 'unauthenticated';
      this.status.details = 'Telegram auth was reset. Start auth again to log in.';
      this.status.lastError = undefined;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
      return this.status;
    }

    try {
      await this.tdClient.invoke({ _: 'logOut' });
      this.activeChatId = null;
      this.latestQrLink = null;
      this.status.authState = 'unauthenticated';
      this.status.details = 'Telegram auth was reset. Start auth again to log in.';
      this.status.lastError = undefined;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
      return this.status;
    } catch (error) {
      this.status.authState = 'degraded';
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Telegram logout error';
      this.status.details = `Telegram logout failed: ${this.status.lastError}`;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
      return this.status;
    }
  }

  async getProfile(): Promise<ConnectorProfile | null> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return null;
    }

    try {
      return await this.fetchOwnProfile(this.tdClient);
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Telegram profile error';
      this.status.details = `Failed loading Telegram profile: ${this.status.lastError}`;
      return null;
    }
  }

  async updateProfile(profile: ConnectorProfileUpdate): Promise<ConnectorProfile | null> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return null;
    }

    const client = this.tdClient;
    let tempDir: string | null = null;

    try {
      if (profile.avatarDataUrl) {
        const upload = await this.prepareUploadFile(
          'pelec-telegram-profile-',
          profile.avatarDataUrl,
          profile.avatarFileName,
          (_fullMimeType, essenceMimeType) => essenceMimeType === 'image/jpeg',
          'profile-photo',
        );
        if (!upload) {
          throw new Error(this.status.lastError || 'Failed preparing Telegram profile photo.');
        }

        tempDir = upload.tempDir;
        await this.invokeWithTimeout(
          client,
          {
            _: 'setProfilePhoto',
            photo: {
              _: 'inputChatPhotoStatic',
              photo: {
                _: 'inputFileLocal',
                path: upload.filePath,
              },
            },
          },
          'setProfilePhoto',
        );
      }

      const nextFirstName = profile.firstName?.trim();
      const nextLastName = profile.lastName?.trim() ?? '';
      if (nextFirstName !== undefined) {
        if (!nextFirstName) {
          throw new Error('Telegram profile first name cannot be empty.');
        }
        await this.invokeWithTimeout(
          client,
          {
            _: 'setName',
            first_name: nextFirstName,
            last_name: nextLastName,
          },
          'setName',
        );
      }

      if (profile.username !== undefined) {
        await this.invokeWithTimeout(
          client,
          {
            _: 'setUsername',
            username: profile.username.trim().replace(/^@+/u, ''),
          },
          'setUsername',
        );
      }

      this.userLabelCache.clear();
      this.userAvatarCache.clear();
      if (tempDir) {
        this.scheduleUploadTempCleanup(tempDir);
      }
      this.emitUpdate({ network: this.network.id, kind: 'chats' });
      return await this.fetchOwnProfile(client);
    } catch (error) {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {
          // Best-effort temp cleanup after failed profile update.
        });
      }
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Telegram profile update error';
      this.status.details = `Failed updating Telegram profile: ${this.status.lastError}`;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
      return null;
    }
  }

  async listChats(): Promise<ChatSummary[]> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return [];
    }
    const client = this.tdClient;

    try {
      for (let i = 0; i < 4; i += 1) {
        try {
          await this.invokeWithTimeout(
            client,
            {
              _: 'loadChats',
              chat_list: { _: 'chatListMain' },
              limit: 100,
            },
            'loadChats',
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.toLowerCase().includes('already')) {
            break;
          }
        }
      }

      const chatsResult = await this.invokeWithTimeout<{ chat_ids?: Array<number | string> }>(
        client,
        {
          _: 'getChats',
          chat_list: { _: 'chatListMain' },
          limit: 120,
        },
        'getChats',
      );

      const chatIds = (chatsResult.chat_ids ?? []).slice(0, 80);
      const scopeMuteForByType = new Map<string, number>();
      const ownUserId = await this.resolveOwnUserId(client);
      const summaryResults = await Promise.allSettled(
        chatIds.map(async (chatId) => {
          const chat = await this.invokeWithTimeout<TdChat>(
            client,
            {
              _: 'getChat',
              chat_id: Number(chatId),
            },
            'getChat',
          );
          const isMuted = await this.isChatMuted(client, chat, scopeMuteForByType);
          const lastMessageOutgoing = this.isTdMessageOutgoing(chat.last_message, ownUserId);
          const previewText = extractTelegramMessageText(chat.last_message?.content, {
            outgoing: lastMessageOutgoing,
          });
          const preview = buildTelegramChatPreview({
            chatTitle: chat.title,
            includeSender: this.shouldIncludeSenderInChatPreview(chat),
            isOutgoing: lastMessageOutgoing,
            previewText,
            senderLabel:
              chat.last_message?.sender_id
                ? await this.resolveSenderLabel(client, chat.last_message.sender_id)
                : undefined,
          });

          return {
            id: String(chat.id ?? chatId),
            title: chat.title ?? 'Untitled chat',
            unreadCount: chat.unread_count ?? 0,
            lastMessagePreview: preview.previewText,
            lastMessageSender: preview.senderLabel,
            lastMessageTimestamp: (chat.last_message?.date ?? 0) * 1000 || undefined,
            lastMessageOutgoing,
            lastMessageReadByPeer:
              lastMessageOutgoing
                ? this.isMessageReadByPeer(chat.last_message.id, chat.last_read_outbox_message_id)
                : undefined,
            avatarUrl: await this.resolveChatAvatar(client, Number(chat.id ?? chatId)),
            isMuted,
            canSend: await this.canSendToChat(client, chat),
            telegramCallCapabilities: await this.resolveCallCapabilities(client, chat),
          } as ChatSummary;
        }),
      );

      const summaries: ChatSummary[] = [];
      let firstError: Error | null = null;
      for (const result of summaryResults) {
        if (result.status === 'fulfilled') {
          summaries.push(result.value);
          continue;
        }
        if (!firstError) {
          firstError =
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason ?? 'Unknown Telegram chat summary error'));
        }
      }

      if (summaries.length < 1 && firstError) {
        throw firstError;
      }

      if (firstError) {
        this.status.lastError = firstError.message;
        this.status.details = `Some Telegram chats could not be loaded: ${this.status.lastError}`;
      } else {
        this.status.lastError = undefined;
      }

      return summaries;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown getChats error';
      this.status.details = `Failed loading Telegram chats: ${this.status.lastError}`;
      throw error instanceof Error ? error : new Error(this.status.lastError);
    }
  }

  async listMessages(chatId: string, options?: ListMessagesOptions): Promise<ChatMessage[]> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return [];
    }

    const client = this.tdClient;

    try {
      const chat = await this.invokeWithTimeout<TdChat>(
        client,
        {
          _: 'getChat',
          chat_id: Number(chatId),
        },
        'getChat',
      );
      const lastReadOutboxMessageId = chat.last_read_outbox_message_id;
      const ownUserId = await this.resolveOwnUserId(client);

      const pageLimit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 80)));
      const beforeMessageId = this.toTdMessageId(options?.beforeMessageId);
      const history: { messages?: TdMessage[] } = await this.invokeWithTimeout<{
        messages?: TdMessage[];
      }>(
        client,
        {
          _: 'getChatHistory',
          chat_id: Number(chatId),
          from_message_id: beforeMessageId ?? 0,
          offset: beforeMessageId ? -1 : 0,
          limit: pageLimit,
          only_local: false,
        },
        'getChatHistory',
      );
      const collected: TdMessage[] = history.messages ?? [];

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
          const localMessageOutgoing = this.isTdMessageOutgoing(localMessage, ownUserId);
          replyContextById.set(replyTargetId, {
            sender: await this.resolveSenderLabel(client, localMessage.sender_id),
            text: extractTelegramMessageText(localMessage.content, {
              outgoing: localMessageOutgoing,
            }),
          });
          continue;
        }

        const remoteMessage = await this.loadMessageById(client, chatId, replyTargetId);
        if (!remoteMessage) {
          continue;
        }
        const remoteMessageOutgoing = this.isTdMessageOutgoing(remoteMessage, ownUserId);
        replyContextById.set(replyTargetId, {
          sender: await this.resolveSenderLabel(client, remoteMessage.sender_id),
          text: extractTelegramMessageText(remoteMessage.content, {
            outgoing: remoteMessageOutgoing,
          }),
        });
      }

      const parsedResults = await Promise.allSettled(
        [...uniqueById.values()].map(async (message) => {
          const replyTargetId = this.extractReplyTargetId(message);
          const replyContext = replyTargetId ? replyContextById.get(replyTargetId) : undefined;
          const videoDimensions = extractTelegramVideoDimensions(message.content);
          const serviceEventDetail = await this.resolveServiceEventDetail(client, message.content);
          const outgoing = this.isTdMessageOutgoing(message, ownUserId);
          return {
            id: String(message.id ?? ''),
            mediaAlbumId: message.media_album_id ? String(message.media_album_id) : undefined,
            sender: await this.resolveSenderLabel(client, message.sender_id),
            text: extractTelegramMessageText(message.content, {
              outgoing,
            }),
            textEntities: extractTelegramMessageEntities(message.content),
            timestamp: (message.date ?? 0) * 1000,
            outgoing,
            canBeEdited: message.can_be_edited,
            readByPeer:
              outgoing
                ? this.isMessageReadByPeer(message.id, lastReadOutboxMessageId)
                : undefined,
            forwardedFrom: await this.resolveForwardOriginLabel(client, message.forward_info),
            replyToMessageId: replyTargetId,
            replyToSender: replyContext?.sender,
            replyToText: replyContext?.text,
            hasAudio: hasTelegramVoiceNote(message.content),
            hasVideo: hasTelegramVideo(message.content),
            imageUrl:
              (getTelegramFileSizeBytes(getTelegramImageFile(message.content)) ?? 0) >
              10 * 1024 * 1024
                ? undefined
                : await this.extractImageUrl(client, message.content),
            imageName: extractTelegramImageName(
              message.content,
              message.id === undefined ? undefined : String(message.id),
            ),
            imageSizeBytes: getTelegramFileSizeBytes(getTelegramImageFile(message.content)),
            imageDeferred:
              (getTelegramFileSizeBytes(getTelegramImageFile(message.content)) ?? 0) >
              10 * 1024 * 1024,
            videoThumbnailUrl: await this.extractVideoThumbnailUrl(client, message.content),
            videoWidth: videoDimensions?.width,
            videoHeight: videoDimensions?.height,
            videoMimeType: extractTelegramVideoMimeType(message.content),
            animationUrl: await this.extractAnimationUrl(client, message.content),
            animationMimeType: extractTelegramAnimationMimeType(message.content),
            stickerUrl: await this.extractStickerUrl(client, message.content),
            stickerEmoji: extractTelegramStickerEmoji(message.content),
            stickerIsAnimated: isTelegramAnimatedSticker(message.content),
            reactions: extractTelegramReactions(message.interaction_info),
            audioDurationSeconds: extractTelegramVoiceDurationSeconds(message.content),
            senderAvatarUrl: await this.resolveSenderAvatar(client, message.sender_id),
            document: extractTelegramDocumentMetadata(message.content),
            call: extractTelegramCallInfo(message.content),
            poll: extractTelegramPollInfo(message.content),
            serviceEvent: extractTelegramServiceEvent(message.content, {
              detail: serviceEventDetail,
            }),
          };
        }),
      );

      const parsed: ChatMessage[] = [];
      let firstError: Error | null = null;
      for (const result of parsedResults) {
        if (result.status === 'fulfilled') {
          parsed.push(result.value);
          continue;
        }
        if (!firstError) {
          firstError =
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason ?? 'Unknown Telegram message parse error'));
        }
      }

      if (parsed.length < 1 && firstError) {
        throw firstError;
      }

      if (firstError) {
        this.status.lastError = firstError.message;
        this.status.details = `Some Telegram messages could not be loaded: ${this.status.lastError}`;
      }

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
      void this.closeChat(client, previousChatId);
    }

    if (!this.activeChatId || this.status.authState !== 'authenticated') {
      return;
    }
  }

  async markChatRead(chatId: string, messageIds?: string[]): Promise<void> {
    if (!this.tdClient || this.status.authState !== 'authenticated' || this.userConfig.ghostMode) {
      return;
    }

    const readableMessageIds = (messageIds ?? [])
      .map((messageId) => this.toTdMessageId(messageId))
      .filter(
        (
          messageId,
        ): messageId is number | bigint => typeof messageId === 'number' || typeof messageId === 'bigint',
      );

    await this.acknowledgeViewedMessageIds(this.tdClient, chatId, readableMessageIds);
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

  async editMessage(chatId: string, messageId: string, text: string): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const tdMessageId = this.toTdMessageId(messageId);
    const messageText = text.trim();
    if (!tdMessageId || !messageText) {
      return false;
    }

    try {
      const message = await this.loadMessageById(this.tdClient, chatId, messageId);
      const canEdit =
        message?.can_be_edited === true ||
        (message?.can_be_edited === undefined && message?.is_outgoing === true);
      if (!canEdit) {
        this.status.lastError = 'Only your editable messages can be edited';
        this.status.details = `Failed editing message: ${this.status.lastError}`;
        return false;
      }

      await this.tdClient.invoke({
        _: 'editMessageText',
        chat_id: Number(chatId),
        message_id: tdMessageId,
        input_message_content: {
          _: 'inputMessageText',
          text: {
            _: 'formattedText',
            text: messageText,
          },
        },
      });
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown editMessage error';
      this.status.details = `Failed editing message: ${this.status.lastError}`;
      return false;
    }
  }

  async setReaction(chatId: string, messageId: string, reaction: string): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const tdMessageId = this.toTdMessageId(messageId);
    const emoji = reaction.trim();
    if (!tdMessageId || !emoji) {
      return false;
    }

    const reactionType = {
      _: 'reactionTypeEmoji',
      emoji,
    };

    try {
      const message = await this.loadMessageById(this.tdClient, chatId, messageId);
      const chosen = extractTelegramReactions(message?.interaction_info)?.some(
        (candidate) => candidate.value === emoji && candidate.chosen === true,
      );

      await this.tdClient.invoke({
        _: chosen ? 'removeMessageReaction' : 'addMessageReaction',
        chat_id: Number(chatId),
        message_id: tdMessageId,
        reaction_type: reactionType,
        ...(chosen
          ? {}
          : {
              is_big: false,
              update_recent_reactions: true,
            }),
      });
      this.status.lastError = undefined;
      this.emitUpdate({ network: this.network.id, kind: 'messages', chatId });
      this.emitUpdate({ network: this.network.id, kind: 'chats', chatId });
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown reaction error';
      this.status.details = `Failed updating reaction: ${this.status.lastError}`;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
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

    const upload = await this.prepareUploadFile(
      'pelec-telegram-image-',
      dataUrl,
      undefined,
      (mimeType) => mimeType.startsWith('image/'),
      'clipboard-image',
    );
    if (!upload) {
      return false;
    }

    let shouldCleanupImmediately = true;
    try {
      const baseRequest = {
        _: 'sendMessage',
        chat_id: Number(chatId),
        input_message_content: {
          _: 'inputMessagePhoto',
          photo: {
            _: 'inputPhoto',
            photo: {
              _: 'inputFileLocal',
              path: upload.filePath,
            },
            thumbnail: null,
          },
          caption: {
            _: 'formattedText',
            text: caption?.trim() ?? '',
            entities: [],
          },
        },
      } as Record<string, unknown>;

      await this.sendTdMessage(baseRequest, replyToMessageId);

      shouldCleanupImmediately = false;
      this.scheduleUploadTempCleanup(upload.tempDir);
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown sendImageMessage error';
      this.status.details = `Failed sending image: ${this.status.lastError}`;
      return false;
    } finally {
      if (shouldCleanupImmediately) {
        await rm(upload.tempDir, { recursive: true, force: true }).catch(() => {
          // Best-effort temp cleanup.
        });
      }
    }
  }

  async sendImageAlbumMessage(
    chatId: string,
    images: OutgoingAttachmentDocument[],
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const albumImages = images.filter((image) => image.dataUrl.trim());
    if (albumImages.length < 1) {
      return false;
    }
    if (albumImages.length === 1) {
      return this.sendImageMessage(chatId, albumImages[0].dataUrl, caption, replyToMessageId);
    }

    const uploads: Array<{ filePath: string; tempDir: string }> = [];
    let shouldCleanupImmediately = true;
    try {
      for (const image of albumImages) {
        const upload = await this.prepareUploadFile(
          'pelec-telegram-image-',
          image.dataUrl,
          image.fileName,
          (mimeType) => mimeType.startsWith('image/'),
          'clipboard-image',
        );
        if (!upload) {
          return false;
        }
        uploads.push(upload);
      }

      const trimmedCaption = caption?.trim() ?? '';
      const baseRequest = {
        _: 'sendMessageAlbum',
        chat_id: Number(chatId),
        input_message_contents: uploads.map<Record<string, unknown>>((upload, index) => ({
          _: 'inputMessagePhoto',
          photo: {
            _: 'inputPhoto',
            photo: {
              _: 'inputFileLocal',
              path: upload.filePath,
            },
            thumbnail: null,
          },
          caption: {
            _: 'formattedText',
            text: index === 0 ? trimmedCaption : '',
            entities: [],
          },
        })),
      } as Record<string, unknown>;

      await this.sendTdMessage(baseRequest, replyToMessageId);

      shouldCleanupImmediately = false;
      for (const upload of uploads) {
        this.scheduleUploadTempCleanup(upload.tempDir);
      }
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown sendImageAlbumMessage error';
      this.status.details = `Failed sending image album: ${this.status.lastError}`;
      return false;
    } finally {
      if (shouldCleanupImmediately) {
        await Promise.all(
          uploads.map((upload) =>
            rm(upload.tempDir, { recursive: true, force: true }).catch(() => {
              // Best-effort temp cleanup.
            }),
          ),
        );
      }
    }
  }

  async sendDocumentMessage(
    chatId: string,
    document: OutgoingAttachmentDocument,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const upload = await this.prepareUploadFile(
      'pelec-telegram-document-',
      document.dataUrl,
      document.fileName,
      () => true,
      'attachment',
    );
    if (!upload) {
      return false;
    }

    let shouldCleanupImmediately = true;
    try {
      const baseRequest = {
        _: 'sendMessage',
        chat_id: Number(chatId),
        input_message_content: {
          _: 'inputMessageDocument',
          document: {
            _: 'inputDocument',
            document: {
              _: 'inputFileLocal',
              path: upload.filePath,
            },
            thumbnail: null,
            disable_content_type_detection: false,
          },
          caption: {
            _: 'formattedText',
            text: caption?.trim() ?? '',
            entities: [],
          },
        },
      } as Record<string, unknown>;

      await this.sendTdMessage(baseRequest, replyToMessageId);

      shouldCleanupImmediately = false;
      this.scheduleUploadTempCleanup(upload.tempDir);
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown sendDocumentMessage error';
      this.status.details = `Failed sending document: ${this.status.lastError}`;
      return false;
    } finally {
      if (shouldCleanupImmediately) {
        await rm(upload.tempDir, { recursive: true, force: true }).catch(() => {
          // Best-effort temp cleanup.
        });
      }
    }
  }

  async sendVoiceMessage(
    chatId: string,
    document: OutgoingAttachmentDocument,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const requestedMimeType = document.mimeType?.trim().toLowerCase();
    if (requestedMimeType && !isSupportedVoiceNoteMimeType(requestedMimeType)) {
      this.setVoiceNoteError('Unsupported Telegram voice note format.');
      return false;
    }

    const upload = await this.prepareVoiceNoteUpload(document);
    if (!upload) {
      return false;
    }

    let shouldCleanupImmediately = true;
    try {
      const baseRequest = {
        _: 'sendMessage',
        chat_id: Number(chatId),
        input_message_content: {
          _: 'inputMessageVoiceNote',
          voice_note: {
            _: 'inputFileLocal',
            path: upload.outputFilePath,
          },
          duration: upload.durationSeconds,
          waveform: '',
          caption: null,
        },
      } as Record<string, unknown>;

      await this.sendTdMessage(baseRequest, replyToMessageId);

      shouldCleanupImmediately = false;
      this.scheduleUploadTempCleanup(upload.tempDir);
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown sendVoiceMessage error';
      this.status.details = `Failed sending voice note: ${this.status.lastError}`;
      return false;
    } finally {
      if (shouldCleanupImmediately) {
        await rm(upload.tempDir, { recursive: true, force: true }).catch(() => {
          // Best-effort temp cleanup.
        });
      }
    }
  }

  async forwardMessage(fromChatId: string, toChatId: string, messageId: string): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const tdMessageId = this.toTdMessageId(messageId);
    if (!tdMessageId) {
      return false;
    }

    try {
      await this.tdClient.invoke({
        _: 'forwardMessages',
        chat_id: Number(toChatId),
        topic_id: null,
        from_chat_id: Number(fromChatId),
        message_ids: [tdMessageId],
        options: null,
        send_copy: false,
        remove_caption: false,
      });
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown forwardMessage error';
      this.status.details = `Failed forwarding message: ${this.status.lastError}`;
      return false;
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

  async resolveImageUrl(chatId: string, messageId: string): Promise<string | undefined> {
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
      return this.extractImageUrl(this.tdClient, message.content);
    } catch {
      return undefined;
    }
  }

  async resolveVideoUrl(chatId: string, messageId: string): Promise<string | undefined> {
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
      return this.extractVideoUrl(this.tdClient, message.content);
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

  async answerPoll(chatId: string, messageId: string, optionIds: number[]): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const tdMessageId = this.toTdMessageId(messageId);
    if (!tdMessageId) {
      return false;
    }

    try {
      await this.tdClient.invoke({
        _: 'setPollAnswer',
        chat_id: Number(chatId),
        message_id: tdMessageId,
        option_ids: optionIds
          .map((value) => Math.floor(Number(value)))
          .filter((value) => Number.isFinite(value) && value >= 0),
      });
      this.status.lastError = undefined;
      this.emitUpdate({ network: this.network.id, kind: 'messages', chatId });
      this.emitUpdate({ network: this.network.id, kind: 'chats', chatId });
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown poll answer error';
      this.status.details = `Failed voting in poll: ${this.status.lastError}`;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
      return false;
    }
  }

  async addPollOption(chatId: string, messageId: string, text: string): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const tdMessageId = this.toTdMessageId(messageId);
    const normalizedText = text.trim();
    if (!tdMessageId || !normalizedText || normalizedText.length > 100) {
      return false;
    }

    try {
      await this.tdClient.invoke({
        _: 'addPollOption',
        chat_id: Number(chatId),
        message_id: tdMessageId,
        option: {
          _: 'inputPollOption',
          text: {
            _: 'formattedText',
            text: normalizedText,
            entities: [],
          },
        },
      });
      this.status.lastError = undefined;
      this.emitUpdate({ network: this.network.id, kind: 'messages', chatId });
      this.emitUpdate({ network: this.network.id, kind: 'chats', chatId });
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown poll option error';
      this.status.details = `Failed adding poll option: ${this.status.lastError}`;
      this.emitUpdate({ network: this.network.id, kind: 'status' });
      return false;
    }
  }

  async listTelegramStickerSets(
    source: TelegramStickerSetSource,
  ): Promise<TelegramStickerSetSummary[]> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return [];
    }

    try {
      if (source === 'recent' || source === 'favorite') {
        const stickers = source === 'favorite'
          ? await this.getFavoriteTelegramStickers(this.tdClient, 24)
          : await this.getRecentTelegramStickers(this.tdClient, 24);
        const thumbnailUrl = (await this.resolveStickerPreview(this.tdClient, stickers[0]))?.url;
        return [
          {
            id: source,
            title: source === 'favorite' ? 'Favorites' : 'Recent',
            source,
            thumbnailUrl,
            stickerCount: stickers.length,
          },
        ];
      }

      const result = await this.invokeWithTimeout<{ sets?: TdStickerSet[] }>(
        this.tdClient,
        {
          _: 'getInstalledStickerSets',
          sticker_type: { _: 'stickerTypeRegular' },
        },
        'getInstalledStickerSets',
      );

      const summaries = await Promise.all(
        (result.sets ?? []).slice(0, 32).map(async (set): Promise<TelegramStickerSetSummary | null> => {
          const setId = String(set.id ?? '').trim();
          const title = set.title?.trim() || set.name?.trim() || 'Sticker set';
          const thumbnailUrl = await this.resolveTdFileRefPreviewUrl(this.tdClient as TdClient, set.thumbnail?.file);
          return setId
            ? {
                id: setId,
                title,
                name: set.name?.trim() || undefined,
                source,
                thumbnailUrl,
                stickerCount: set.stickers?.length,
              }
            : null;
        }),
      );

      return summaries.filter((set): set is TelegramStickerSetSummary => set !== null);
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Telegram sticker-set error';
      this.status.details = `Failed loading Telegram sticker sets: ${this.status.lastError}`;
      return [];
    }
  }

  async listTelegramPickerItems(query: TelegramPickerQuery): Promise<TelegramPickerItem[]> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return [];
    }

    const limit = Math.max(1, Math.min(80, Math.floor(query.limit ?? 48)));

    try {
      if (query.kind === 'gif') {
        const animations = query.query?.trim()
          ? await this.searchTelegramAnimations(this.tdClient, query.query.trim(), limit)
          : await this.getSavedTelegramAnimations(this.tdClient, limit);
        return this.mapTelegramAnimationsForPicker(this.tdClient, animations, limit);
      }

      let stickers: TdSticker[] = [];
      let setTitle: string | undefined;
      if (query.setId?.trim() && !['recent', 'favorite'].includes(query.setId.trim())) {
        const set = await this.getTelegramStickerSet(this.tdClient, query.setId.trim());
        stickers = set?.stickers ?? [];
        setTitle = set?.title;
      } else if (query.query?.trim() || query.emoji?.trim()) {
        stickers = await this.searchTelegramStickers(
          this.tdClient,
          query.emoji?.trim() || query.query?.trim() || '',
          query.query?.trim() || '',
          limit,
        );
      } else if (query.setId?.trim() === 'favorite') {
        stickers = await this.getFavoriteTelegramStickers(this.tdClient, limit);
        setTitle = 'Favorites';
      } else {
        stickers = await this.getRecentTelegramStickers(this.tdClient, limit);
        setTitle = 'Recent';
        if (stickers.length < 1) {
          stickers = await this.getFavoriteTelegramStickers(this.tdClient, limit);
          setTitle = 'Favorites';
        }
      }

      return this.mapTelegramStickersForPicker(this.tdClient, stickers, limit, setTitle);
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Telegram picker item error';
      this.status.details = `Failed loading Telegram picker items: ${this.status.lastError}`;
      return [];
    }
  }

  async sendTelegramPickerItem(
    chatId: string,
    item: TelegramPickerItem,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!this.tdClient || this.status.authState !== 'authenticated') {
      return false;
    }

    const fileId = Number(item.id);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return false;
    }

    try {
      const inputFile = {
        _: 'inputFileId',
        id: fileId,
      };
      const baseRequest = {
        _: 'sendMessage',
        chat_id: Number(chatId),
        input_message_content:
          item.kind === 'gif'
            ? {
                _: 'inputMessageAnimation',
                animation: {
                  _: 'inputAnimation',
                  animation: inputFile,
                  thumbnail: null,
                  added_sticker_file_ids: [],
                  duration: 0,
                  width: item.width ?? 0,
                  height: item.height ?? 0,
                },
                caption: {
                  _: 'formattedText',
                  text: '',
                  entities: [],
                },
              }
            : {
                _: 'inputMessageSticker',
                sticker: inputFile,
                thumbnail: null,
                emoji: item.emoji ?? '',
                width: item.width ?? 0,
                height: item.height ?? 0,
              },
      } as Record<string, unknown>;

      await this.sendTdMessage(baseRequest, replyToMessageId);
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Telegram picker send error';
      this.status.details = `Failed sending Telegram media: ${this.status.lastError}`;
      return false;
    }
  }

  private resolveQrWaiters(link: string | null): void {
    for (const resolve of this.qrWaiters) {
      resolve(link);
    }
    this.qrWaiters = [];
  }

  private async getRecentTelegramStickers(client: TdClient, limit: number): Promise<TdSticker[]> {
    const result = await this.invokeWithTimeout<{ stickers?: TdSticker[] }>(
      client,
      {
        _: 'getRecentStickers',
        is_attached: false,
      },
      'getRecentStickers',
    );
    return (result.stickers ?? []).slice(0, limit);
  }

  private async getFavoriteTelegramStickers(client: TdClient, limit: number): Promise<TdSticker[]> {
    const result = await this.invokeWithTimeout<{ stickers?: TdSticker[] }>(
      client,
      {
        _: 'getFavoriteStickers',
      },
      'getFavoriteStickers',
    );
    return (result.stickers ?? []).slice(0, limit);
  }

  private async getTelegramStickerSet(
    client: TdClient,
    setId: string,
  ): Promise<TdStickerSet | undefined> {
    const numericSetId = Number(setId);
    if (!Number.isFinite(numericSetId) || numericSetId <= 0) {
      return undefined;
    }

    return this.invokeWithTimeout<TdStickerSet>(
      client,
      {
        _: 'getStickerSet',
        set_id: numericSetId,
      },
      'getStickerSet',
    );
  }

  private async searchTelegramStickers(
    client: TdClient,
    emoji: string,
    query: string,
    limit: number,
  ): Promise<TdSticker[]> {
    const requests: Array<Record<string, unknown>> = [
      {
        _: 'searchStickers',
        sticker_type: { _: 'stickerTypeRegular' },
        emojis: emoji,
        query,
        limit,
      },
      {
        _: 'searchStickers',
        emoji,
        limit,
      },
    ];

    for (const request of requests) {
      try {
        const result = await this.invokeWithTimeout<{ stickers?: TdSticker[] }>(
          client,
          request,
          'searchStickers',
        );
        const stickers = result.stickers ?? [];
        if (stickers.length > 0) {
          return stickers.slice(0, limit);
        }
      } catch {
        // Try the next TDLib shape; searchStickers changed over TDLib versions.
      }
    }

    return [];
  }

  private async getSavedTelegramAnimations(client: TdClient, limit: number): Promise<TdAnimation[]> {
    const result = await this.invokeWithTimeout<{ animations?: TdAnimation[] }>(
      client,
      {
        _: 'getSavedAnimations',
      },
      'getSavedAnimations',
    );
    return (result.animations ?? []).slice(0, limit);
  }

  private async searchTelegramAnimations(
    client: TdClient,
    query: string,
    limit: number,
  ): Promise<TdAnimation[]> {
    const requests: Array<Record<string, unknown>> = [
      {
        _: 'searchAnimations',
        query,
        limit,
      },
      {
        _: 'getAnimationSearchResults',
        query,
        offset: '',
        limit,
      },
    ];

    for (const request of requests) {
      try {
        const result = await this.invokeWithTimeout<{
          animations?: TdAnimation[];
          results?: TdAnimation[];
        }>(
          client,
          request,
          String(request._),
        );
        const animations = result.animations ?? result.results ?? [];
        if (animations.length > 0) {
          return animations.slice(0, limit);
        }
      } catch {
        // Try the next Telegram animation search method name.
      }
    }

    return [];
  }

  private async mapTelegramStickersForPicker(
    client: TdClient,
    stickers: TdSticker[],
    limit: number,
    setTitle?: string,
  ): Promise<TelegramPickerItem[]> {
    const items = await Promise.all(
      stickers.slice(0, limit).map(async (sticker) => {
        const preview = await this.resolveStickerPreview(client, sticker);
        return mapTelegramStickerToPickerItem(
          sticker,
          preview?.url,
          preview?.mimeType,
          setTitle,
        );
      }),
    );
    return items.filter((item): item is TelegramPickerItem => item !== undefined);
  }

  private async mapTelegramAnimationsForPicker(
    client: TdClient,
    animations: TdAnimation[],
    limit: number,
  ): Promise<TelegramPickerItem[]> {
    const items = await Promise.all(
      animations.slice(0, limit).map(async (animation) => {
        const preview = await this.resolveAnimationPreview(client, animation);
        return mapTelegramAnimationToPickerItem(animation, preview?.url, preview?.mimeType);
      }),
    );
    return items.filter((item): item is TelegramPickerItem => item !== undefined);
  }

  private async resolveStickerPreview(
    client: TdClient,
    sticker: TdSticker | undefined,
  ): Promise<{ url: string; mimeType: string } | undefined> {
    const previewFile = getTelegramStickerPreviewFile(sticker);
    return this.resolveTdFileRefPreview(client, previewFile);
  }

  private async resolveAnimationPreview(
    client: TdClient,
    animation: TdAnimation | undefined,
  ): Promise<{ url: string; mimeType: string } | undefined> {
    return this.resolveTdFileRefPreview(client, getTelegramAnimationPreviewFile(animation));
  }

  private async resolveTdFileRefPreviewUrl(
    client: TdClient,
    file: TdFileRef | undefined,
  ): Promise<string | undefined> {
    return (await this.resolveTdFileRefPreview(client, file))?.url;
  }

  private async resolveTdFileRefPreview(
    client: TdClient,
    file: TdFileRef | undefined,
  ): Promise<{ url: string; mimeType: string } | undefined> {
    if (!file) {
      return undefined;
    }

    const localPath = await resolveTdFilePath({
      client,
      file,
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
    });
    if (!localPath) {
      return undefined;
    }

    const mimeType = inferTelegramLocalMimeType(localPath);
    return {
      url: buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME, mimeType),
      mimeType,
    };
  }

  private toTdMessageId(value: string | undefined): number | bigint | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const asBigInt = BigInt(trimmed);
      if (asBigInt <= 0n) {
        return undefined;
      }
      if (asBigInt <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(asBigInt);
      }
      return asBigInt;
    } catch {
      const asNumber = Number(trimmed);
      if (!Number.isFinite(asNumber) || asNumber <= 0) {
        return undefined;
      }
      return asNumber;
    }
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
        this.status.qrLink = link;
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
      this.status.qrLink = null;
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
      void this.callService.shutdown();
      this.status.authState = 'unauthenticated';
      this.status.details = 'TDLib authorization state is closed. Reinitializing Telegram...';
      this.status.lastError = undefined;
      this.activeChatId = null;
      this.status.qrLink = null;
      this.latestQrLink = null;
      this.resolveQrWaiters(null);
      void this.recoverTdlib();
    }
  }

  private async initTdlib(): Promise<void> {
    if (this.tdlibInitPromise) {
      await this.tdlibInitPromise;
      return;
    }

    this.tdlibInitPromise = this.tryInitTdlib().finally(() => {
      this.tdlibInitPromise = null;
    });
    await this.tdlibInitPromise;
  }

  private async recoverTdlib(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    if (this.tdlibRecoveryPromise) {
      await this.tdlibRecoveryPromise;
      return;
    }

    this.tdlibRecoveryPromise = (async () => {
      const client = this.tdClient;
      this.tdClient = null;
      this.tdLibReady = false;
      this.status.qrLink = null;
      this.latestQrLink = null;
      this.activeChatId = null;
      this.resolveQrWaiters(null);
      await this.disposeTdClient(client);
      await this.initTdlib();
      this.emitUpdate({ network: this.network.id, kind: 'status' });
    })().finally(() => {
      this.tdlibRecoveryPromise = null;
    });

    await this.tdlibRecoveryPromise;
  }

  private async disposeTdClient(client: TdClient | null): Promise<void> {
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

  private async closeChat(client: TdClient, chatId: string): Promise<void> {
    try {
      await this.invokeWithTimeout(
        client,
        {
          _: 'closeChat',
          chat_id: Number(chatId),
        },
        'closeChat',
        TELEGRAM_TDLIB_CHAT_SWITCH_TIMEOUT_MS,
      );
    } catch {
      // Best-effort close; failure is non-fatal for message rendering.
    }
  }

  private async acknowledgeViewedMessageIds(
    client: TdClient,
    chatId: string,
    messageIds: Array<number | bigint>,
  ): Promise<void> {
    if (messageIds.length < 1) {
      return;
    }

    try {
      await this.invokeWithTimeout(
        client,
        {
          _: 'viewMessages',
          chat_id: Number(chatId),
          message_ids: messageIds,
          source: null,
          force_read: true,
        },
        'viewMessages',
        TELEGRAM_TDLIB_CHAT_SWITCH_TIMEOUT_MS,
      );
      return;
    } catch {
      // Fall back for TDLib variants that don't accept force_read/source.
    }

    try {
      await this.invokeWithTimeout(
        client,
        {
          _: 'viewMessages',
          chat_id: Number(chatId),
          message_ids: messageIds,
        },
        'viewMessages',
        TELEGRAM_TDLIB_CHAT_SWITCH_TIMEOUT_MS,
      );
    } catch {
      // Best-effort read acknowledgement only.
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

  private async resolveOwnUserId(client: TdClient): Promise<number | null> {
    if (this.ownUserId !== null) {
      return this.ownUserId;
    }

    try {
      const user = await this.invokeWithTimeout<{ id?: number }>(
        client,
        {
          _: 'getMe',
        },
        'getMe',
      );
      const userId = Number(user.id ?? 0);
      this.ownUserId = Number.isFinite(userId) && userId > 0 ? userId : null;
      return this.ownUserId;
    } catch {
      return null;
    }
  }

  private isTdMessageOutgoing(
    message:
      | {
          is_outgoing?: boolean;
          sender_id?: { user_id?: number; _?: string };
        }
      | undefined,
    ownUserId: number | null,
  ): boolean {
    if (!message) {
      return false;
    }
    if (typeof message.is_outgoing === 'boolean') {
      return message.is_outgoing;
    }
    return (
      ownUserId !== null &&
      message.sender_id?._ === 'messageSenderUser' &&
      message.sender_id.user_id === ownUserId
    );
  }

  private async resolveServiceEventDetail(client: TdClient, content: unknown): Promise<string | undefined> {
    if (!content || typeof content !== 'object') {
      return undefined;
    }

    const event = content as {
      _?: string;
      member_user_ids?: unknown[];
      user_id?: number;
    };

    if (event._ === 'messageChatAddMembers') {
      const userIds = (Array.isArray(event.member_user_ids) ? event.member_user_ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (userIds.length < 1) {
        return undefined;
      }
      const labels = await Promise.all(userIds.map((userId) => this.resolveUserLabel(client, userId)));
      return labels.map((label) => label.trim()).filter(Boolean).join(', ') || undefined;
    }

    if (event._ === 'messageChatDeleteMember' && event.user_id) {
      return this.resolveUserLabel(client, event.user_id);
    }

    return undefined;
  }

  private async resolveForwardOriginLabel(
    client: TdClient,
    forwardInfo:
      | {
          origin?: {
            _?: string;
            sender_user_id?: number;
            sender_name?: string;
            sender_chat_id?: number;
            chat_id?: number;
            author_signature?: string;
          };
        }
      | undefined,
  ): Promise<string | undefined> {
    const origin = forwardInfo?.origin;
    if (!origin?._) {
      return undefined;
    }

    if (origin._ === 'messageOriginUser' && origin.sender_user_id) {
      return this.resolveUserLabel(client, origin.sender_user_id);
    }

    if (origin._ === 'messageOriginHiddenUser') {
      return origin.sender_name?.trim() || 'Hidden user';
    }

    if (origin._ === 'messageOriginChat' && origin.sender_chat_id) {
      const chatTitle = await this.resolveChatTitle(client, origin.sender_chat_id);
      const signature = origin.author_signature?.trim();
      return signature ? `${chatTitle} (${signature})` : chatTitle;
    }

    if (origin._ === 'messageOriginChannel' && origin.chat_id) {
      const chatTitle = await this.resolveChatTitle(client, origin.chat_id);
      const signature = origin.author_signature?.trim();
      return signature ? `${chatTitle} (${signature})` : chatTitle;
    }

    return undefined;
  }

  private async fetchOwnProfile(client: TdClient): Promise<ConnectorProfile> {
    const user = await this.invokeWithTimeout<{
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      usernames?: { active_usernames?: string[] };
      profile_photo?: { small?: { id?: number; local?: { path?: string } } };
    }>(
      client,
      {
        _: 'getMe',
      },
      'getMe',
    );

    const firstName = user.first_name?.trim() ?? '';
    const lastName = user.last_name?.trim() ?? '';
    const username =
      user.usernames?.active_usernames?.[0]?.trim() ??
      user.username?.trim() ??
      undefined;
    const displayName = `${firstName} ${lastName}`.trim() || 'Telegram user';
    const avatarUrl = await resolveTdFileUrl({
      client,
      file: user.profile_photo?.small,
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
      mediaDataUrlCache: this.mediaDataUrlCache,
    }).catch((): string | undefined => undefined);

    if (user.id && displayName) {
      this.ownUserId = user.id;
      const label = username ? `${displayName} (@${username})` : displayName;
      this.userLabelCache.set(user.id, label);
      this.userAvatarCache.set(user.id, avatarUrl);
    }

    return {
      displayName,
      firstName,
      lastName,
      username,
      avatarUrl,
    };
  }

  private async resolveUserLabel(client: TdClient, userId: number): Promise<string> {
    const cached = this.userLabelCache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      const user = await this.invokeWithTimeout<{
        first_name?: string;
        last_name?: string;
        username?: string;
        usernames?: { active_usernames?: string[] };
      }>(
        client,
        {
          _: 'getUser',
          user_id: userId,
        },
        'getUser',
      );

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
      const user = await this.invokeWithTimeout<{
        profile_photo?: { small?: { id?: number; local?: { path?: string } } };
      }>(
        client,
        {
          _: 'getUser',
          user_id: userId,
        },
        'getUser',
      );
      const avatar = await resolveTdFileUrl({
        client,
        file: user.profile_photo?.small,
        invokeWithTimeout: this.invokeWithTimeout.bind(this),
        downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
        mediaDataUrlCache: this.mediaDataUrlCache,
      });
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
      const chat = await this.invokeWithTimeout<{ title?: string }>(
        client,
        {
          _: 'getChat',
          chat_id: chatId,
        },
        'getChat',
      );
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
      const chat = await this.invokeWithTimeout<{
        photo?: { small?: { id?: number; local?: { path?: string } } };
      }>(
        client,
        {
          _: 'getChat',
          chat_id: chatId,
        },
        'getChat',
      );
      const avatar = await resolveTdFileUrl({
        client,
        file: chat.photo?.small,
        invokeWithTimeout: this.invokeWithTimeout.bind(this),
        downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
        mediaDataUrlCache: this.mediaDataUrlCache,
      });
      this.chatAvatarCache.set(chatId, avatar);
      return avatar;
    } catch {
      this.chatAvatarCache.set(chatId, undefined);
      return undefined;
    }
  }

  private shouldIncludeSenderInChatPreview(chat: TdChat): boolean {
    const chatType = chat.type?._;
    if (chatType === 'chatTypeBasicGroup') {
      return true;
    }

    return chatType === 'chatTypeSupergroup' && chat.type?.is_channel !== true;
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
    const imageDocument = extractTelegramImageDocumentSource(content);
    if (imageDocument) {
      const localPath = await resolveTdFilePath({
        client,
        file: imageDocument.file,
        invokeWithTimeout: this.invokeWithTimeout.bind(this),
        downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
      });
      return localPath ? buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME) : undefined;
    }

    const photos = extractTelegramPhotoFiles(content);
    if (photos.length < 1) {
      return undefined;
    }

    for (let i = photos.length - 1; i >= 0; i -= 1) {
      const localPath = photos[i]?.local?.path?.trim();
      if (localPath) {
        return buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME);
      }
    }

    const localPath = await resolveTdFilePath({
      client,
      file: photos[photos.length - 1],
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
    });
    if (!localPath) {
      return undefined;
    }
    return buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME);
  }

  private async extractVideoThumbnailUrl(
    client: TdClient,
    content: unknown,
  ): Promise<string | undefined> {
    const thumbnail = extractTelegramVideoThumbnailFile(content);
    if (!thumbnail) {
      return undefined;
    }

    const localPath = await resolveTdFilePath({
      client,
      file: thumbnail,
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
    });
    return localPath ? buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME) : undefined;
  }

  private async extractStickerUrl(
    client: TdClient,
    content: unknown,
  ): Promise<string | undefined> {
    const sticker = extractTelegramStickerSource(content);
    if (!sticker) {
      return undefined;
    }

    if (sticker.animated && sticker.format === 'stickerFormatWebm') {
      const localPath = await resolveTdPlayableFilePath({
        client,
        file: sticker.sticker,
        invokeWithTimeout: this.invokeWithTimeout.bind(this),
        downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
        downloadPollIntervalMs: TELEGRAM_TDLIB_DOWNLOAD_POLL_INTERVAL_MS,
      });
      if (!localPath) {
        return undefined;
      }

      return buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME);
    }

    if (sticker.animated) {
      return resolveTdFileUrl({
        client,
        file: sticker.thumbnail,
        preferredMimeType: 'image/jpeg',
        invokeWithTimeout: this.invokeWithTimeout.bind(this),
        downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
        mediaDataUrlCache: this.mediaDataUrlCache,
      });
    }

    return resolveTdFileUrl({
      client,
      file: sticker.sticker,
      preferredMimeType: 'image/webp',
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
      mediaDataUrlCache: this.mediaDataUrlCache,
    });
  }

  private async extractAnimationUrl(
    client: TdClient,
    content: unknown,
  ): Promise<string | undefined> {
    const animation = extractTelegramAnimationSource(content);
    if (!animation) {
      return undefined;
    }

    return resolveTdFileUrl({
      client,
      file: animation.file,
      preferredMimeType: animation.mimeType ?? 'video/mp4',
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
      mediaDataUrlCache: this.mediaDataUrlCache,
    });
  }

  private async extractVideoUrl(
    client: TdClient,
    content: unknown,
  ): Promise<string | undefined> {
    const videoFile = extractTelegramVideoFile(content);
    if (!videoFile) {
      return undefined;
    }

    const localPath = await resolveTdPlayableFilePath({
      client,
      file: videoFile,
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
      downloadPollIntervalMs: TELEGRAM_TDLIB_DOWNLOAD_POLL_INTERVAL_MS,
    });
    if (!localPath) {
      return undefined;
    }

    return buildTelegramLocalMediaUrl(localPath, PELEC_MEDIA_SCHEME);
  }

  private async extractVoiceNoteUrl(client: TdClient, content: unknown): Promise<string | undefined> {
    const voiceFile = extractTelegramVoiceNoteFile(content);
    if (!voiceFile) {
      return undefined;
    }

    return resolveTdFileUrl({
      client,
      file: voiceFile,
      preferredMimeType: 'audio/ogg;codecs=opus',
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
      mediaDataUrlCache: this.mediaDataUrlCache,
    });
  }

  private extractDocumentMetadata(content: unknown): ChatDocument | undefined {
    return extractTelegramDocumentMetadata(content);
  }

  private async extractResolvedDocument(
    client: TdClient,
    content: unknown,
  ): Promise<ResolvedDocument | undefined> {
    const document = getTelegramDocument(content);
    if (!document) {
      return undefined;
    }

    const filePath = await resolveTdFilePath({
      client,
      file: document.file,
      invokeWithTimeout: this.invokeWithTimeout.bind(this),
      downloadTimeoutMs: TELEGRAM_TDLIB_DOWNLOAD_TIMEOUT_MS,
    });
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
      return await this.invokeWithTimeout<TdMessage>(
        client,
        {
          _: 'getMessage',
          chat_id: Number(chatId),
          message_id: tdMessageId,
        },
        'getMessage',
      );
    } catch {
      return undefined;
    }
  }

  private async prepareUploadFile(
    tempPrefix: string,
    dataUrl: string,
    fileName: string | undefined,
    validateMimeType: (fullMimeType: string, essenceMimeType: string) => boolean,
    fallbackBaseName: string,
  ): Promise<PreparedUploadFile | undefined> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      this.status.lastError = 'Attachment payload is invalid.';
      this.status.details = `Failed preparing upload: ${this.status.lastError}`;
      return undefined;
    }

    if (!validateMimeType(parsed.fullMimeType, parsed.essenceMimeType)) {
      this.status.lastError = `Unsupported attachment format: ${parsed.fullMimeType}`;
      this.status.details = `Failed preparing upload: ${this.status.lastError}`;
      return undefined;
    }

    if (parsed.bytes.byteLength > TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES) {
      this.status.lastError = `Attachment exceeds ${Math.round(
        TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024),
      )} MB limit`;
      this.status.details = `Failed preparing upload: ${this.status.lastError}`;
      return undefined;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
    const resolvedFileName = resolveUploadFileName(fileName, parsed.essenceMimeType, fallbackBaseName);
    const filePath = path.join(tempDir, resolvedFileName);
    await writeFile(filePath, parsed.bytes);
    return {
      tempDir,
      filePath,
      mimeType: parsed.fullMimeType,
    };
  }

  private async prepareVoiceNoteUpload(
    document: OutgoingAttachmentDocument,
  ): Promise<PreparedVoiceNoteUpload | undefined> {
    const parsed = parseDataUrl(document.dataUrl);
    if (!parsed) {
      this.setVoiceNoteError('Voice note payload is invalid.');
      return undefined;
    }

    if (!isSupportedVoiceNoteMimeType(parsed.fullMimeType)) {
      this.setVoiceNoteError(`Unsupported Telegram voice note format: ${parsed.fullMimeType}`);
      return undefined;
    }

    if (parsed.bytes.byteLength > TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES) {
      this.setVoiceNoteError(
        `Voice note exceeds ${Math.round(TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))} MB limit.`,
      );
      return undefined;
    }

    let tempDir: string | undefined;

    try {
      tempDir = await mkdtemp(path.join(os.tmpdir(), 'pelec-telegram-voice-'));
      const sourceFileName = resolveUploadFileName(
        document.fileName,
        parsed.essenceMimeType,
        'voice-note',
      );
      const sourceFilePath = path.join(tempDir, sourceFileName);
      const outputFilePath = path.join(tempDir, 'voice-note.ogg');
      await writeFile(sourceFilePath, parsed.bytes);

      if (parsed.fullMimeType === 'audio/ogg;codecs=opus') {
        if (sourceFilePath !== outputFilePath) {
          await copyFile(sourceFilePath, outputFilePath);
        }
      } else {
        await this.transcodeVoiceNoteToOgg(sourceFilePath, outputFilePath);
      }

      const durationSeconds = await this.probeAudioDurationSeconds(outputFilePath);
      return {
        tempDir,
        sourceFilePath,
        outputFilePath,
        outputMimeType: 'audio/ogg;codecs=opus',
        durationSeconds,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown voice note preparation error';
      this.setVoiceNoteError(message);
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {
          // Best-effort temp cleanup.
        });
      }
      return undefined;
    }
  }

  private async sendTdMessage(
    baseRequest: Record<string, unknown>,
    replyToMessageId?: string,
  ): Promise<void> {
    if (!this.tdClient) {
      throw new Error('TDLib client is unavailable');
    }

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
      return;
    }

    await this.tdClient.invoke(baseRequest);
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

  private setVoiceNoteError(message: string): void {
    this.status.lastError = message;
    this.status.details = `Failed sending voice note: ${message}`;
  }

  private async transcodeVoiceNoteToOgg(
    sourceFilePath: string,
    outputFilePath: string,
  ): Promise<void> {
    const ffmpegBinaryPath = await getFfmpegBinaryPath().catch((error) => {
      throw new Error(
        error instanceof Error ? error.message : 'Bundled ffmpeg binary is unavailable.',
      );
    });

    const result = await this.runBinary(ffmpegBinaryPath, [
      '-y',
      '-i',
      sourceFilePath,
      '-vn',
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      '24k',
      '-f',
      'ogg',
      outputFilePath,
    ]);

    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim();
      throw new Error(stderr || `ffmpeg exited with code ${result.exitCode}.`);
    }
  }

  private async probeAudioDurationSeconds(filePath: string): Promise<number> {
    try {
      const ffprobeBinaryPath = await getFfprobeBinaryPath();
      const result = await this.runBinary(ffprobeBinaryPath, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      if (result.exitCode !== 0) {
        return 0;
      }

      const durationSeconds = Number(result.stdout.trim());
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
      }

      return Math.max(1, Math.round(durationSeconds));
    } catch {
      return 0;
    }
  }

  private async runBinary(
    binaryPath: string,
    args: string[],
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        reject(error);
      });
      child.on('close', (exitCode) => {
        resolve({
          exitCode,
          stdout,
          stderr,
        });
      });
    });
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
        path.join(
          process.resourcesPath,
          'app.asar.unpacked',
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

      const client = tdl.createClient(clientConfig) as TdClient;
      this.tdClient = client;

      client.on('update', (payload: unknown) => {
        if (this.tdClient !== client || this.isShuttingDown) {
          return;
        }
        const update = payload as TdUpdateWithChatContext;
        const chatId = this.extractUpdateChatId(update);
        if (update._ === 'updateAuthorizationState' && update.authorization_state) {
          this.handleAuthorizationState(update.authorization_state);
          this.emitUpdate({ network: this.network.id, kind: 'status' });
          return;
        }

        if (update._ === 'updateCall' && update.call) {
          void this.callService.handleTdCall(update.call);
          return;
        }

        if (update._ === 'updateNewCallSignalingData') {
          this.callService.handleSignalingData(update.call_id, update.data);
          return;
        }

        if (update._ === 'updateGroupCall' && update.group_call) {
          void this.callService.handleGroupCall(update.group_call);
          return;
        }

        if (update._ === 'updateGroupCallParticipant' && update.participant) {
          void this.callService.handleGroupParticipant(update.participant);
          return;
        }

        if (update._ === 'updateNewMessage' || update._ === 'updateMessageContent') {
          this.emitUpdate({
            network: this.network.id,
            kind: 'messages',
            chatId,
          });
          this.emitUpdate({ network: this.network.id, kind: 'chats', chatId });
          return;
        }

        if (update._ === 'updateChatReadOutbox') {
          this.emitUpdate({
            network: this.network.id,
            kind: 'messages-invalidated',
            chatId,
            reason: 'read-state',
          });
          this.emitUpdate({ network: this.network.id, kind: 'chats', chatId });
          return;
        }

        if (
          update._ === 'updateDeleteMessages' ||
          update._ === 'updateMessageEdited' ||
          update._ === 'updateMessageSendSucceeded' ||
          update._ === 'updateMessageSendFailed'
        ) {
          this.emitUpdate({
            network: this.network.id,
            kind: 'messages',
            chatId,
          });
          return;
        }

        if (
          update._ === 'updateChatLastMessage' ||
          update._ === 'updateChatPosition' ||
          update._ === 'updateChatTitle' ||
          update._ === 'updateChatPhoto' ||
          update._ === 'updateChatReadInbox' ||
          update._ === 'updateChatDraftMessage' ||
          update._ === 'updateChatVideoChat'
        ) {
          this.emitUpdate({ network: this.network.id, kind: 'chats', chatId });
        }
      });

      client.on('error', (payload: unknown) => {
        if (this.tdClient !== client || this.isShuttingDown) {
          return;
        }
        const message = payload instanceof Error ? payload.message : String(payload);
        this.status.authState = 'degraded';
        this.status.lastError = message;
        this.status.details = `TDLib runtime error: ${message}`;
        this.emitUpdate({ network: this.network.id, kind: 'status' });
      });

      client.on('close', () => {
        if (this.tdClient !== client || this.isShuttingDown) {
          return;
        }
        this.status.authState = 'unauthenticated';
        this.status.lastError = undefined;
        this.status.details = 'Telegram connection closed. Reinitializing TDLib...';
        this.emitUpdate({ network: this.network.id, kind: 'status' });
        void this.recoverTdlib();
      });

      this.tdLibReady = true;
      this.status.mode = 'native';
      if (this.status.authState !== 'authenticated' && this.status.authState !== 'authenticating') {
        this.status.authState = 'unauthenticated';
        this.status.details = 'TDLib initialized. Start auth to open QR login.';
      }
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

  private emitUpdate(event: ConnectorUpdateEvent | LegacyConnectorUpdateEvent): void {
    const nextEvent =
      event.kind === 'status'
        ? {
            network: this.network.id,
            kind: 'status-changed' as const,
            authState: this.status.authState,
            mode: this.status.mode,
            details: this.status.details,
          }
        : event.kind === 'chats'
          ? {
              network: this.network.id,
              kind: 'chat-list-invalidated' as const,
              changedChatIds: event.chatId ? [event.chatId] : undefined,
            }
          : event.kind === 'messages'
            ? {
                network: this.network.id,
                kind: 'messages-invalidated' as const,
                chatId: event.chatId ?? '',
                reason: 'history' as const,
              }
            : event;

    if (nextEvent.kind === 'messages-invalidated' && !nextEvent.chatId) {
      return;
    }

    for (const listener of this.updateListeners) {
      listener(nextEvent);
    }
  }

  private extractUpdateChatId(update: TdUpdateWithChatContext): string | undefined {
    const rawChatId = update.chat_id ?? update.message?.chat_id;
    return typeof rawChatId === 'number' ? String(rawChatId) : undefined;
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
      const settings = await this.invokeWithTimeout<TdScopeNotificationSettings>(
        client,
        {
          _: 'getScopeNotificationSettings',
          scope: { _: scope },
        },
        'getScopeNotificationSettings',
      );
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

  private async canSendToChat(client: TdClient, chat: TdChat): Promise<boolean> {
    const chatType = chat.type?._;
    if (chatType === 'chatTypePrivate' || chatType === 'chatTypeSecret') {
      return true;
    }

    const nonAdminCanSend = chat.permissions?.can_send_basic_messages === true;

    if (chatType === 'chatTypeBasicGroup') {
      if (chat.permissions && typeof chat.permissions.can_send_basic_messages === 'boolean') {
        return nonAdminCanSend;
      }

      const basicGroupId = chat.type?.basic_group_id;
      if (!basicGroupId) {
        return true;
      }

      try {
        const group = await this.invokeWithTimeout<TdBasicGroup>(
          client,
          {
            _: 'getBasicGroup',
            basic_group_id: basicGroupId,
          },
          'getBasicGroup',
        );
        return this.canSendForMemberStatus(group.status, false);
      } catch {
        return true;
      }
    }

    if (chatType === 'chatTypeSupergroup') {
      const isChannel = chat.type?.is_channel === true;
      if (!isChannel && chat.permissions && typeof chat.permissions.can_send_basic_messages === 'boolean') {
        return nonAdminCanSend;
      }
      if (isChannel && nonAdminCanSend) {
        return true;
      }

      const supergroupId = chat.type?.supergroup_id;
      if (!supergroupId) {
        return !isChannel;
      }

      try {
        const supergroup = await this.invokeWithTimeout<TdSupergroup>(
          client,
          {
            _: 'getSupergroup',
            supergroup_id: supergroupId,
          },
          'getSupergroup',
        );
        return this.canSendForMemberStatus(
          supergroup.status,
          isChannel || supergroup.is_channel === true || supergroup.is_broadcast_group === true,
          supergroup.is_direct_messages_group === true,
        );
      } catch {
        return !isChannel;
      }
    }

    return true;
  }

  private async resolveCallCapabilities(
    client: TdClient,
    chat: TdChat,
  ): Promise<ChatSummary['telegramCallCapabilities']> {
    const groupCallId = chat.video_chat?.group_call_id;
    if (groupCallId && this.userConfig.calls.group) {
      return {
        callable: false,
        supportsVideo: false,
        activeGroupCallId: groupCallId,
      };
    }

    const userId = chat.type?._ === 'chatTypePrivate' ? chat.type.user_id : undefined;
    if (!userId || !this.userConfig.calls.privateVoice) {
      return {
        callable: false,
        supportsVideo: false,
      };
    }

    const cached = this.callCapabilityCache.get(userId);
    if (cached) {
      return { ...cached };
    }

    try {
      const fullInfo = await this.invokeWithTimeout<{
        can_be_called?: boolean;
        supports_video_calls?: boolean;
        has_private_calls?: boolean;
      }>(
        client,
        { _: 'getUserFullInfo', user_id: userId },
        'getUserFullInfo for call capabilities',
      );
      const capabilities = {
        callable: Boolean(fullInfo.can_be_called && !fullInfo.has_private_calls),
        supportsVideo: Boolean(
          this.userConfig.calls.privateVideo && fullInfo.supports_video_calls,
        ),
      };
      this.callCapabilityCache.set(userId, capabilities);
      return { ...capabilities };
    } catch {
      return {
        callable: false,
        supportsVideo: false,
      };
    }
  }

  private canSendForMemberStatus(
    status: TdChatMemberStatus | undefined,
    isChannel: boolean,
    isDirectMessagesGroup = false,
  ): boolean {
    const kind = status?._;
    if (!kind) {
      return true;
    }

    if (kind === 'chatMemberStatusCreator') {
      return status.is_member !== false;
    }

    if (kind === 'chatMemberStatusAdministrator') {
      return !isChannel || isDirectMessagesGroup || status.rights?.can_post_messages === true;
    }

    if (kind === 'chatMemberStatusMember') {
      return !isChannel || isDirectMessagesGroup;
    }

    if (kind === 'chatMemberStatusRestricted') {
      return (
        status.is_member === true &&
        (!isChannel || isDirectMessagesGroup) &&
        status.permissions?.can_send_basic_messages === true
      );
    }

    return false;
  }
}
