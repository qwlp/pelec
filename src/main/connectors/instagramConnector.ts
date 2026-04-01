import type {
  AuthStartResult,
  AuthSubmission,
  ChatMessage,
  ChatSummary,
  Connector,
  ConnectorUpdateEvent,
  ConnectorStatus,
  ListMessagesOptions,
} from '../../shared/connectors';
import type { NetworkDefinition } from '../../shared/types';
import { verifyInstagramCapability } from './instagram/capability';
import {
  adoptInstagramWebSession,
  fetchCurrentUser,
  fetchInbox,
  fetchThread,
  loginInstagram,
  resetInstagramAuthState,
  sendThreadMessage,
  submitInstagramChallengeCode,
  submitInstagramTwoFactorCode,
} from './instagram/client';
import {
  buildParticipantMaps,
  mapItemToChatMessage,
  mapThreadToChatSummary,
} from './instagram/mappers';

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
  private status: ConnectorStatus;
  private updateListeners = new Set<(event: ConnectorUpdateEvent) => void>();
  private authLog(...args: unknown[]): void {
    console.info('[instagram-auth][connector]', ...args);
  }
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  constructor(
    private readonly network: NetworkDefinition,
    private readonly userDataPath: string,
  ) {
    this.status = {
      network: this.network.id,
      mode: 'web-fallback',
      authState: 'unauthenticated',
      capabilities: {
        qr: false,
        twoFactor: true,
        officialApi: false,
      },
      partition: this.network.partition,
      webUrl: this.network.homeUrl,
      details: 'Checking Instagram native DM capability.',
    };
  }

  async init(): Promise<void> {
    await this.detectCapability();
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
    this.authLog('start-auth:begin', { partition: this.network.partition });
    this.status.authState = 'authenticating';
    this.emitUpdate('status');

    let capability:
      | { ok: boolean; details: string; username?: string; requiresTwoFactor?: boolean; requiresChallenge?: boolean }
      | undefined;
    try {
      capability = await this.withTimeout(
        verifyInstagramCapability(this.userDataPath, this.network.partition),
        9000,
        'Timed out while checking Instagram capability.',
      );
      this.authLog('start-auth:capability', capability);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.authLog('start-auth:capability-timeout-or-error', { message });
      this.status.mode = 'web-fallback';
      this.status.authState = 'unauthenticated';
      this.status.details = 'Instagram auth check timed out. Use web login and retry.';
      this.status.lastError = message;
      this.emitUpdate('status');
      return {
        network: this.network.id,
        mode: 'browser',
        instructions: 'Instagram auth check timed out. Log in in web view, then run auth again.',
        webUrl: 'https://www.instagram.com/accounts/login/',
      };
    }

    if (capability.ok) {
      this.status.mode = 'native';
      this.status.authState = 'authenticated';
      this.status.details = capability.username
        ? `Instagram native mode active for @${capability.username}.`
        : 'Instagram native mode active.';
      this.status.lastError = undefined;
      this.emitUpdate('status');
      return {
        network: this.network.id,
        mode: 'none',
        instructions: this.status.details,
      };
    }

    this.status.mode = 'web-fallback';
    this.status.authState =
      capability.requiresTwoFactor || capability.requiresChallenge ? 'authenticating' : 'unauthenticated';
    this.status.details = capability.requiresTwoFactor
      ? 'Instagram 2FA is pending. Submit your verification code.'
      : capability.requiresChallenge
        ? 'Instagram challenge is pending. Submit your security code.'
      : 'Instagram requires username/password for native mode.';
    this.status.lastError = capability.details;
    this.emitUpdate('status');

    if (capability.requiresTwoFactor) {
      return {
        network: this.network.id,
        mode: 'code',
        instructions:
          'Enter your Instagram 2FA code to complete native login. Web login remains available as fallback.',
      };
    }

    if (capability.requiresChallenge) {
      return {
        network: this.network.id,
        mode: 'code',
        instructions: `${capability.details} If no code arrives, complete the checkpoint in Instagram web/app and then retry auth.`,
      };
    }

    return {
      network: this.network.id,
      mode: 'password',
      instructions:
        'Enter Instagram username and password to enable native DM mode. Web login remains available as fallback.',
    };
  }

  async submitAuth(payload: AuthSubmission): Promise<ConnectorStatus> {
    this.authLog('submit-auth:begin', { type: payload.type, valuePreview: payload.value.slice(0, 20) });
    if (payload.type === 'code') {
      if (payload.value.trim() === 'session-check') {
        const adopted = await adoptInstagramWebSession(this.userDataPath, this.network.partition);
        this.authLog('submit-auth:session-check-result', adopted);
        if (!adopted.ok) {
          this.status.authState = 'unauthenticated';
          this.status.mode = 'web-fallback';
          this.status.details = adopted.details;
          this.status.lastError = adopted.details;
          this.emitUpdate('status');
          return this.status;
        }
      } else {
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
          this.status.mode = 'web-fallback';
          this.status.details = codeResult.details;
          this.status.lastError = codeResult.details;
          this.emitUpdate('status');
          return this.status;
        }
      }

      await this.detectCapability();
      this.emitUpdate('status');
      return this.status;
    }

    if (payload.type === 'password' || payload.type === 'token') {
      const credentials = parseCredentialPayload(payload.value);
      if (!credentials) {
        this.status.authState = 'degraded';
        this.status.details =
          'Invalid auth payload. Expected JSON {"username","password"} or username:password.';
        this.status.lastError = this.status.details;
        this.emitUpdate('status');
        return this.status;
      }

      const loginResult = await loginInstagram(
        this.userDataPath,
        this.network.partition,
        credentials.username,
        credentials.password,
      );
      this.authLog('submit-auth:password-result', {
        ok: loginResult.ok,
        requiresTwoFactor: loginResult.requiresTwoFactor,
        details: loginResult.details,
      });

      if (!loginResult.ok) {
        this.status.authState = loginResult.requiresTwoFactor || loginResult.requiresChallenge
          ? 'authenticating'
          : 'degraded';
        this.status.mode = 'web-fallback';
        this.status.details = loginResult.details;
        this.status.lastError = loginResult.details;
        this.emitUpdate('status');
        return this.status;
      }

      await this.detectCapability();
      this.emitUpdate('status');
      return this.status;
    }

    await this.detectCapability();
    this.emitUpdate('status');
    return this.status;
  }

  async resetAuth(): Promise<ConnectorStatus> {
    await resetInstagramAuthState(this.userDataPath, this.network.partition);
    this.status.mode = 'web-fallback';
    this.status.authState = 'unauthenticated';
    this.status.details = 'Instagram auth was reset. Start auth again to enter your username and password.';
    this.status.lastError = undefined;
    this.emitUpdate('status');
    return this.status;
  }

  async listChats(): Promise<ChatSummary[]> {
    if (this.status.mode !== 'native' || this.status.authState !== 'authenticated') {
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
      this.markDegraded(error, 'Failed to load Instagram chats. Falling back to web mode.');
      this.emitUpdate('status');
      return [];
    }
  }

  async listMessages(chatId: string, _options?: ListMessagesOptions): Promise<ChatMessage[]> {
    if (!chatId || this.status.mode !== 'native' || this.status.authState !== 'authenticated') {
      return [];
    }

    try {
      const threadData = await fetchThread(this.userDataPath, this.network.partition, chatId);
      const thread = threadData.thread;
      const currentUser = await fetchCurrentUser(this.userDataPath, this.network.partition);
      const currentUserPk = currentUser.user?.pk !== undefined ? String(currentUser.user.pk) : undefined;
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
      return [];
    }
  }

  async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<boolean> {
    if (!chatId || !text.trim()) {
      return false;
    }
    if (this.status.mode !== 'native' || this.status.authState !== 'authenticated') {
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
      if (result.status !== 'ok') {
        throw new Error('Instagram send did not return ok status');
      }
      this.status.lastError = undefined;
      this.emitUpdate('messages', chatId);
      this.emitUpdate('chats');
      return true;
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error.message : 'Unknown Instagram send error';
      this.status.details = `Instagram send failed: ${this.status.lastError}`;
      return false;
    }
  }

  private async detectCapability(): Promise<void> {
    const result = await verifyInstagramCapability(this.userDataPath, this.network.partition);
    if (!result.ok) {
      this.status.mode = 'web-fallback';
      this.status.authState =
        result.requiresTwoFactor || result.requiresChallenge ? 'authenticating' : 'unauthenticated';
      this.status.details = result.requiresTwoFactor
        ? 'Instagram 2FA required. Submit your code to complete native login.'
        : result.requiresChallenge
          ? 'Instagram challenge required. Submit your code to complete native login.'
          : isCheckpointStatus(result.details)
            ? 'Instagram checkpoint required. Complete the challenge in web view, then retry auth.'
          : 'Instagram native mode unavailable until login is completed.';
      this.status.lastError = result.details;
      return;
    }

    this.status.mode = 'native';
    this.status.authState = 'authenticated';
    this.status.details = result.username
      ? `Instagram native mode active for @${result.username}.`
      : result.details;
    this.status.lastError = undefined;
  }

  private markDegraded(error: unknown, details: string): void {
    this.status.mode = 'web-fallback';
    this.status.authState = 'degraded';
    this.status.details = details;
    this.status.lastError =
      error instanceof Error ? error.message : 'Unknown Instagram connector error';
  }

  private emitUpdate(kind: ConnectorUpdateEvent['kind'], chatId?: string): void {
    for (const handler of this.updateListeners) {
      handler({
        network: this.network.id,
        kind,
        chatId,
      });
    }
  }
}
