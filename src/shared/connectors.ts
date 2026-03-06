import type { NetworkId } from './types';

export type ConnectorMode = 'native' | 'api' | 'web-fallback';

export type AuthState =
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'degraded';

export type AuthMode =
  | 'qr'
  | 'browser'
  | 'token'
  | 'phone'
  | 'code'
  | 'password'
  | 'none';

export interface ConnectorCapabilities {
  qr: boolean;
  twoFactor: boolean;
  officialApi: boolean;
}

export interface ConnectorStatus {
  network: NetworkId;
  mode: ConnectorMode;
  authState: AuthState;
  capabilities: ConnectorCapabilities;
  partition: string;
  webUrl: string;
  details: string;
  lastError?: string;
}

export interface AuthStartResult {
  network: NetworkId;
  mode: AuthMode;
  instructions: string;
  webUrl?: string;
  qrLink?: string;
  requiresTwoFactor?: boolean;
}

export interface AuthSubmission {
  type: 'password' | 'token' | 'code' | 'phone';
  value: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  lastMessagePreview: string;
  unreadCount: number;
  avatarUrl?: string;
  isMuted?: boolean;
}

export interface ChatReaction {
  value: string;
  count: number;
  chosen?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  outgoing?: boolean;
  readByPeer?: boolean;
  replyToMessageId?: string;
  replyToSender?: string;
  replyToText?: string;
  hasAudio?: boolean;
  imageUrl?: string;
  animationUrl?: string;
  animationMimeType?: string;
  stickerUrl?: string;
  stickerEmoji?: string;
  stickerIsAnimated?: boolean;
  reactions?: ChatReaction[];
  audioUrl?: string;
  audioDurationSeconds?: number;
  senderAvatarUrl?: string;
}

export interface ConnectorUpdateEvent {
  network: NetworkId;
  kind: 'chats' | 'messages' | 'status';
  chatId?: string;
}

export interface Connector {
  init(): Promise<void>;
  shutdown?(): Promise<void>;
  getStatus(): ConnectorStatus;
  startAuth(): Promise<AuthStartResult>;
  submitAuth(payload: AuthSubmission): Promise<ConnectorStatus>;
  resetAuth?(): Promise<ConnectorStatus>;
  setActiveChat?(chatId?: string | null): Promise<void>;
  listChats?(): Promise<ChatSummary[]>;
  listMessages?(chatId: string): Promise<ChatMessage[]>;
  resolveAudioUrl?(chatId: string, messageId: string): Promise<string | undefined>;
  sendImageMessage?(
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean>;
  sendMessage?(chatId: string, text: string, replyToMessageId?: string): Promise<boolean>;
  deleteMessage?(chatId: string, messageId: string): Promise<boolean>;
  onUpdate?(handler: (event: ConnectorUpdateEvent) => void): () => void;
}
