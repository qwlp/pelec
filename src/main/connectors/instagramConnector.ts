import type {
  AuthStartResult,
  AuthSubmission,
  ChatMessage,
  ChatSummary,
  Connector,
  ConnectorStatus,
  ConnectorUpdateEvent,
  OutgoingAttachmentDocument,
} from '../../shared/connectors';
import type { NetworkDefinition } from '../../shared/types';
import { verifyInstagramCapability } from './instagram/capability';
import {
  deleteThreadMessage,
  fetchCurrentUser,
  fetchInbox,
  fetchThread,
  getBroadcastItemId,
  getInstagramRealtimeStatus,
  loginInstagram,
  markInstagramThreadRead,
  resetInstagramAuthState,
  sendThreadImage,
  sendThreadMessage,
  sendThreadVideo,
  submitInstagramChallengeCode,
  submitInstagramTwoFactorCode,
  subscribeInstagramRuntimeEvents,
} from './instagram/client';
import {
  buildParticipantMaps,
  mapItemToChatMessage,
  mapThreadToChatSummary,
} from './instagram/mappers';
import type { InstagramRuntimeEvent } from './instagram/types';

const parseCredentialPayload = (value: string): { username: string; password: string } | undefined => {
  const raw = value.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as { username?: string; password?: string };
    const username = parsed.username?.trim();
    const password = typeof parsed.password === 'string' ? parsed.password : undefined;
    if (username && password) {
      return { username, password };
    }
  } catch {
    // Non-JSON payloads are supported as "username:password".
  }

  const separatorIndex = raw.indexOf(':');
  if (separatorIndex < 1) {
    return undefined;
  }

  const username = raw.slice(0, separatorIndex).trim();
  const password = raw.slice(separatorIndex + 1);
  if (!username || !password) {
    return undefined;
  }

  return { username, password };
};

const isCheckpointStatus = (details?: string): boolean => {
  if (!details) {
    return false;
  }
  const lowered = details.toLowerCase();
  return lowered.includes('checkpoint');
};

export class InstagramConnector implements Connector {
  private cleanupRuntimeSubscription: (() => void) | null = null;

  private readonly updateListeners = new Set<(event: ConnectorUpdateEvent) => void>();

  private activeChatId: string | null = null;

  private status: ConnectorStatus;

  constructor(
    private readonly network: NetworkDefinition,
    private readonly userDataPath: string,
  ) {
    this.status = {
      network: this.network.id,
      mode: 'native',
      authState: 'unauthenticated',
      capabilities: {
        qr: false,
        twoFactor: true,
        officialApi: false,
      },
      realtimeStatus: 'disconnected',
      partition: this.network.partition,
      webUrl: this.network.homeUrl,
      details: 'Checking Instagram native DM capability.',
    };
  }

  async init(): Promise<void> {
    await this.detectCapability();
    await this.ensureRuntimeSubscription();
    this.emitStatusUpdate();
  }

  async shutdown(): Promise<void> {
    this.cleanupRuntimeSubscription?.();
    this.cleanupRuntimeSubscription = null;
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
    this.status.authState = 'authenticating';
    this.emitStatusUpdate();

    const capability = await verifyInstagramCapability(this.userDataPath, this.network.partition);
    if (capability.ok) {
      await this.detectCapability();
      return {
        network: this.network.id,
        mode: 'none',
        instructions: this.status.details,
      };
    }

    this.status.authState =
      capability.requiresTwoFactor || capability.requiresChallenge ? 'authenticating' : 'unauthenticated';
    this.status.details = capability.requiresTwoFactor
      ? 'Instagram 2FA is pending. Submit your verification code.'
      : capability.requiresChallenge
        ? 'Instagram challenge is pending. Submit your security code.'
        : isCheckpointStatus(capability.details)
          ? 'Instagram checkpoint review is required in the browser/app. Complete it there, then retry.'
          : 'Instagram requires username and password for native mode.';
    this.status.lastError = capability.details;
    this.emitStatusUpdate();

    if (capability.requiresTwoFactor || capability.requiresChallenge) {
      return {
        network: this.network.id,
        mode: 'code',
        instructions: this.status.details,
      };
    }

    return {
      network: this.network.id,
      mode: 'password',
      instructions: this.status.details,
    };
  }

  async submitAuth(payload: AuthSubmission): Promise<ConnectorStatus> {
    if (payload.type === 'code') {
      const currentCapability = await verifyInstagramCapability(this.userDataPath, this.network.partition);
      const codeResult = currentCapability.requiresChallenge
        ? await submitInstagramChallengeCode(
            this.userDataPath,
            this.network.partition,
            payload.value,
          )
        : await submitInstagramTwoFactorCode(
            this.userDataPath,
            this.network.partition,
            payload.value,
          );
      if (!codeResult.ok) {
        this.status.authState = codeResult.requiresTwoFactor || codeResult.requiresChallenge
          ? 'authenticating'
          : 'unauthenticated';
        this.status.details = codeResult.details;
        this.status.lastError = codeResult.details;
        this.emitStatusUpdate();
        return this.status;
      }

      await this.detectCapability();
      await this.ensureRuntimeSubscription();
      this.emitStatusUpdate();
      return this.status;
    }

    if (payload.type === 'password' || payload.type === 'token') {
      const credentials = parseCredentialPayload(payload.value);
      if (!credentials) {
        this.status.authState = 'degraded';
        this.status.details =
          'Invalid auth payload. Expected JSON {"username","password"} or username:password.';
        this.status.lastError = this.status.details;
        this.emitStatusUpdate();
        return this.status;
      }

      const loginResult = await loginInstagram(
        this.userDataPath,
        this.network.partition,
        credentials.username,
        credentials.password,
      );
      if (!loginResult.ok) {
        this.status.authState = loginResult.requiresTwoFactor || loginResult.requiresChallenge
          ? 'authenticating'
          : 'degraded';
        this.status.details = loginResult.details;
        this.status.lastError = loginResult.details;
        this.emitStatusUpdate();
        return this.status;
      }

      await this.detectCapability();
      await this.ensureRuntimeSubscription();
      this.emitStatusUpdate();
      return this.status;
    }

    await this.detectCapability();
    this.emitStatusUpdate();
    return this.status;
  }

  async resetAuth(): Promise<ConnectorStatus> {
    this.cleanupRuntimeSubscription?.();
    this.cleanupRuntimeSubscription = null;
    await resetInstagramAuthState(this.userDataPath, this.network.partition);
    this.status.mode = 'native';
    this.status.authState = 'unauthenticated';
    this.status.realtimeStatus = 'disconnected';
    this.status.details = 'Instagram auth was reset. Start auth again to log in natively.';
    this.status.lastError = undefined;
    this.emitStatusUpdate();
    return this.status;
  }

  async listChats(): Promise<ChatSummary[]> {
    if (!(await this.ensureAuthenticated())) {
      return [];
    }

    try {
      const inbox = await fetchInbox(this.userDataPath, this.network.partition);
      const chats = (inbox.inbox?.threads ?? [])
        .map(mapThreadToChatSummary)
        .filter((chat) => chat.id);
      this.status.lastError = undefined;
      return chats;
    } catch (error) {
      this.status.details = 'Failed to load Instagram chats.';
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Instagram chat error';
      this.emitStatusUpdate();
      throw error;
    }
  }

  async listMessages(chatId: string): Promise<ChatMessage[]> {
    if (!chatId) {
      return [];
    }

    if (!(await this.ensureAuthenticated())) {
      return [];
    }

    try {
      const threadData = await fetchThread(this.userDataPath, this.network.partition, chatId);
      const thread = threadData.thread;
      let currentUserPk =
        thread?.viewer_id !== undefined ? String(thread.viewer_id) : undefined;
      let currentUser: Awaited<ReturnType<typeof fetchCurrentUser>> | undefined;
      if (!currentUserPk) {
        currentUser = await fetchCurrentUser(this.userDataPath, this.network.partition);
        currentUserPk = currentUser.user?.pk !== undefined ? String(currentUser.user.pk) : undefined;
      }
      const { senderLabelById, senderAvatarById } = buildParticipantMaps(thread, currentUser);
      const messages = (thread?.items ?? [])
        .map((item) => mapItemToChatMessage(item, senderLabelById, senderAvatarById, currentUserPk))
        .sort((a, b) => a.timestamp - b.timestamp);
      this.status.lastError = undefined;
      return messages;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Instagram message error';
      this.status.details = `Failed to load Instagram messages: ${this.status.lastError}`;
      this.emitStatusUpdate();
      throw error;
    }
  }

  async setActiveChat(chatId?: string | null): Promise<void> {
    this.activeChatId = chatId?.trim() ? chatId.trim() : null;
  }

  async markChatRead(chatId: string, messageIds?: string[]): Promise<void> {
    if (!chatId || this.status.authState !== 'authenticated') {
      return;
    }

    const targetMessageId = messageIds?.[messageIds.length - 1];
    if (!targetMessageId) {
      return;
    }

    try {
      await markInstagramThreadRead(this.userDataPath, this.network.partition, chatId, targetMessageId);
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Failed to update read state.';
      this.status.details = `Instagram read-state refresh failed: ${this.status.lastError}`;
      this.emitStatusUpdate();
    }
  }

  async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<boolean> {
    if (!chatId || !text.trim()) {
      return false;
    }

    if (!(await this.ensureAuthenticated())) {
      return false;
    }

    try {
      const result = await sendThreadMessage(
        this.userDataPath,
        this.network.partition,
        chatId,
        text.trim(),
        replyToMessageId,
      );
      void getBroadcastItemId(result);
      this.status.lastError = undefined;
      this.emitMessagesInvalidated(chatId, 'outgoing');
      this.emitChatListInvalidated([chatId]);
      return true;
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Instagram send error';
      this.status.details = `Instagram send failed: ${this.status.lastError}`;
      this.emitStatusUpdate();
      return false;
    }
  }

  async sendImageMessage(
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!chatId || !dataUrl) {
      return false;
    }

    if (!(await this.ensureAuthenticated())) {
      return false;
    }

    try {
      await sendThreadImage(
        this.userDataPath,
        this.network.partition,
        chatId,
        dataUrl,
        caption,
        replyToMessageId,
      );
      this.emitMessagesInvalidated(chatId, 'outgoing');
      this.emitChatListInvalidated([chatId]);
      return true;
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Instagram image error';
      this.status.details = `Instagram image send failed: ${this.status.lastError}`;
      this.emitStatusUpdate();
      return false;
    }
  }

  async sendVideoMessage(
    chatId: string,
    document: OutgoingAttachmentDocument,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    if (!chatId || !document.dataUrl) {
      return false;
    }

    if (!(await this.ensureAuthenticated())) {
      return false;
    }

    try {
      await sendThreadVideo(
        this.userDataPath,
        this.network.partition,
        chatId,
        document,
        caption,
        replyToMessageId,
      );
      this.emitMessagesInvalidated(chatId, 'outgoing');
      this.emitChatListInvalidated([chatId]);
      return true;
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Instagram video error';
      this.status.details = `Instagram video send failed: ${this.status.lastError}`;
      this.emitStatusUpdate();
      return false;
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    if (!chatId || !messageId) {
      return false;
    }

    if (!(await this.ensureAuthenticated())) {
      return false;
    }

    try {
      await deleteThreadMessage(this.userDataPath, this.network.partition, chatId, messageId);
      this.emitMessagesInvalidated(chatId, 'history');
      this.emitChatListInvalidated([chatId]);
      return true;
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Unknown Instagram delete error';
      this.status.details = `Instagram delete failed: ${this.status.lastError}`;
      this.emitStatusUpdate();
      return false;
    }
  }

  private async detectCapability(): Promise<void> {
    const result = await verifyInstagramCapability(this.userDataPath, this.network.partition);
    this.status.mode = 'native';
    this.status.realtimeStatus = await getInstagramRealtimeStatus(this.userDataPath, this.network.partition);
    if (!result.ok) {
      this.status.authState =
        result.requiresTwoFactor || result.requiresChallenge ? 'authenticating' : 'unauthenticated';
      this.status.details = result.requiresTwoFactor
        ? 'Instagram 2FA required. Submit your code to complete native login.'
        : result.requiresChallenge
          ? 'Instagram challenge required. Submit your code to complete native login.'
          : isCheckpointStatus(result.details)
            ? 'Instagram checkpoint required. Complete it in the browser/app, then retry auth.'
            : 'Instagram native mode unavailable until login is completed.';
      this.status.lastError = result.details;
      return;
    }

    this.status.authState = 'authenticated';
    this.status.details = result.username
      ? `Instagram native mode active for @${result.username}.`
      : result.details;
    this.status.lastError = undefined;
  }

  private async ensureRuntimeSubscription(): Promise<void> {
    if (this.cleanupRuntimeSubscription) {
      return;
    }
    this.cleanupRuntimeSubscription = await subscribeInstagramRuntimeEvents(
      this.userDataPath,
      this.network.partition,
      (event) => {
        this.handleRuntimeEvent(event);
      },
    );
  }

  private handleRuntimeEvent(event: InstagramRuntimeEvent): void {
    if (event.kind === 'realtime-status') {
      this.status.realtimeStatus = event.status;
      this.emitStatusUpdate();
      return;
    }

    this.emitChatListInvalidated(event.threadId ? [event.threadId] : undefined);
    if (event.kind === 'message') {
      this.emitMessagesInvalidated(event.threadId, 'incoming');
      return;
    }
    if (event.kind === 'reaction') {
      this.emitMessagesInvalidated(event.threadId, 'history');
      return;
    }
    if (event.kind === 'seen') {
      this.emitMessagesInvalidated(event.threadId, 'read-state');
    }
  }

  private async ensureAuthenticated(): Promise<boolean> {
    if (this.status.authState === 'authenticated') {
      return true;
    }

    try {
      await this.detectCapability();
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Failed to verify Instagram auth state.';
      this.status.details = `Instagram auth check failed: ${this.status.lastError}`;
      this.emitStatusUpdate();
      return false;
    }

    const authState: ConnectorStatus['authState'] = this.getStatus().authState;
    if (authState !== 'authenticated') {
      this.emitStatusUpdate();
      return false;
    }

    return true;
  }

  private emitStatusUpdate(): void {
    for (const handler of this.updateListeners) {
      handler({
        network: this.network.id,
        kind: 'status-changed',
        authState: this.status.authState,
        mode: this.status.mode,
        details: this.status.details,
      });
    }
  }

  private emitChatListInvalidated(changedChatIds?: string[]): void {
    for (const handler of this.updateListeners) {
      handler({
        network: this.network.id,
        kind: 'chat-list-invalidated',
        changedChatIds,
      });
    }
  }

  private emitMessagesInvalidated(
    chatId: string,
    reason: 'incoming' | 'outgoing' | 'history' | 'read-state',
  ): void {
    for (const handler of this.updateListeners) {
      handler({
        network: this.network.id,
        kind: 'messages-invalidated',
        chatId,
        reason,
      });
    }
  }
}
