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
  qrLink?: string | null;
  lastError?: string;
}

export interface ConnectorProfile {
  displayName: string;
  firstName: string;
  lastName: string;
  username?: string;
  avatarUrl?: string;
}

export interface ConnectorProfileUpdate {
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarDataUrl?: string;
  avatarFileName?: string;
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
  lastMessageSender?: string;
  lastMessageTimestamp?: number;
  unreadCount: number;
  avatarUrl?: string;
  isMuted?: boolean;
  canSend?: boolean;
}

export interface ChatReaction {
  value: string;
  count: number;
  chosen?: boolean;
}

export interface ChatPollOption {
  text: string;
  voterCount: number;
  votePercentage?: number;
  chosen?: boolean;
}

export interface ChatPoll {
  question: string;
  options: ChatPollOption[];
  totalVoterCount?: number;
  isAnonymous?: boolean;
  isClosed?: boolean;
  allowsMultipleAnswers?: boolean;
  kind: 'regular' | 'quiz';
  correctOptionIndex?: number;
}

export type ChatTextEntityType =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'underline'
  | 'spoiler'
  | 'code'
  | 'pre'
  | 'preCode'
  | 'textUrl'
  | 'url';

export interface ChatTextEntity {
  offset: number;
  length: number;
  type: ChatTextEntityType;
  url?: string;
  language?: string;
}

export interface ChatDocument {
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface OutgoingAttachmentDocument {
  dataUrl: string;
  fileName: string;
  mimeType?: string;
}

export interface ChatCall {
  isVideo?: boolean;
  durationSeconds?: number;
  discardReason?: 'missed' | 'declined' | 'disconnected' | 'hung_up' | 'empty';
}

export interface ResolvedDocument extends ChatDocument {
  filePath: string;
}

export interface ListMessagesOptions {
  passive?: boolean;
  beforeMessageId?: string;
  limit?: number;
}

export interface ChatMessage {
  id: string;
  mediaAlbumId?: string;
  sender: string;
  text: string;
  textEntities?: ChatTextEntity[];
  timestamp: number;
  outgoing?: boolean;
  readByPeer?: boolean;
  forwardedFrom?: string;
  replyToMessageId?: string;
  replyToSender?: string;
  replyToText?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  imageUrl?: string;
  imageSizeBytes?: number;
  imageDeferred?: boolean;
  videoUrl?: string;
  videoMimeType?: string;
  animationUrl?: string;
  animationMimeType?: string;
  stickerUrl?: string;
  stickerEmoji?: string;
  stickerIsAnimated?: boolean;
  reactions?: ChatReaction[];
  audioUrl?: string;
  audioDurationSeconds?: number;
  senderAvatarUrl?: string;
  document?: ChatDocument;
  call?: ChatCall;
  poll?: ChatPoll;
}

export type ConnectorInvalidationReason = 'incoming' | 'outgoing' | 'history' | 'read-state';

export type ConnectorUpdateEvent =
  | {
      network: NetworkId;
      kind: 'status-changed';
      authState: AuthState;
      mode: ConnectorMode;
      details: string;
    }
  | {
      network: NetworkId;
      kind: 'chat-list-invalidated';
      changedChatIds?: string[];
    }
  | {
      network: NetworkId;
      kind: 'messages-invalidated';
      chatId: string;
      reason: ConnectorInvalidationReason;
    };

export interface Connector {
  init(): Promise<void>;
  shutdown?(): Promise<void>;
  getStatus(): ConnectorStatus;
  getProfile?(): Promise<ConnectorProfile | null>;
  updateProfile?(profile: ConnectorProfileUpdate): Promise<ConnectorProfile | null>;
  startAuth(): Promise<AuthStartResult>;
  submitAuth(payload: AuthSubmission): Promise<ConnectorStatus>;
  resetAuth?(): Promise<ConnectorStatus>;
  setActiveChat?(chatId?: string | null): Promise<void>;
  listChats?(): Promise<ChatSummary[]>;
  listMessages?(chatId: string, options?: ListMessagesOptions): Promise<ChatMessage[]>;
  markChatRead?(chatId: string, messageIds?: string[]): Promise<void>;
  resolveAudioUrl?(chatId: string, messageId: string): Promise<string | undefined>;
  resolveImageUrl?(chatId: string, messageId: string): Promise<string | undefined>;
  resolveVideoUrl?(chatId: string, messageId: string): Promise<string | undefined>;
  resolveDocument?(chatId: string, messageId: string): Promise<ResolvedDocument | undefined>;
  answerPoll?(chatId: string, messageId: string, optionIds: number[]): Promise<boolean>;
  sendImageMessage?(
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean>;
  sendDocumentMessage?(
    chatId: string,
    document: OutgoingAttachmentDocument,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean>;
  sendVoiceMessage?(
    chatId: string,
    document: OutgoingAttachmentDocument,
    replyToMessageId?: string,
  ): Promise<boolean>;
  sendMessage?(chatId: string, text: string, replyToMessageId?: string): Promise<boolean>;
  forwardMessage?(fromChatId: string, toChatId: string, messageId: string): Promise<boolean>;
  deleteMessage?(chatId: string, messageId: string): Promise<boolean>;
  onUpdate?(handler: (event: ConnectorUpdateEvent) => void): () => void;
}
