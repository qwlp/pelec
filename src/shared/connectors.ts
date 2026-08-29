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
  lastMessageOutgoing?: boolean;
  lastMessageReadByPeer?: boolean;
  unreadCount: number;
  avatarUrl?: string;
  isMuted?: boolean;
  canSend?: boolean;
  telegramCallCapabilities?: TelegramCallCapabilities;
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
  description?: string;
  options: ChatPollOption[];
  totalVoterCount?: number;
  isAnonymous?: boolean;
  isClosed?: boolean;
  allowsMultipleAnswers?: boolean;
  allowsRevoting?: boolean;
  canAddOption?: boolean;
  canSeeResults?: boolean;
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

export type TelegramCallKind = 'private' | 'group';
export type TelegramCallDirection = 'incoming' | 'outgoing' | 'joined';
export type TelegramCallPhase =
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'established'
  | 'reconnecting'
  | 'hanging-up'
  | 'ended'
  | 'failed';

export interface TelegramCallCapabilities {
  callable: boolean;
  supportsVideo: boolean;
  activeGroupCallId?: number;
  canManageGroupCall?: boolean;
}

export interface TelegramCallSession {
  sessionId: string;
  kind: TelegramCallKind;
  chatId?: string;
  userId?: number;
  groupCallId?: number;
  peerLabel: string;
  direction: TelegramCallDirection;
  isVideo: boolean;
  phase: TelegramCallPhase;
  startedAt?: number;
  durationSeconds: number;
  microphoneMuted: boolean;
  cameraEnabled: boolean;
  encryptionEmojis: string[];
  error?: string;
}

export interface TelegramCallParticipant {
  id: string;
  displayName: string;
  audioSourceId?: number;
  speaking: boolean;
  muted: boolean;
  volume: number;
  isCurrentUser: boolean;
  videoEndpointId?: string;
  videoSourceGroups?: Array<{
    semantics: string;
    sourceIds: number[];
  }>;
  screenEndpointId?: string;
  videoPaused?: boolean;
}

export interface TelegramCallDevice {
  id: string;
  label: string;
  kind: 'audio-input' | 'audio-output' | 'camera';
  selected?: boolean;
}

export interface TelegramCallMetrics {
  signalBars?: number;
  audioLevel?: number;
  bytesSent?: number;
  bytesReceived?: number;
}

export interface TelegramCallVideoFrame {
  endpointId: string;
  width: number;
  height: number;
  timestamp: number;
  data: Uint8Array;
}

export type TelegramCallUpdate =
  | { kind: 'session'; session: TelegramCallSession | null }
  | { kind: 'participants'; participants: TelegramCallParticipant[] }
  | { kind: 'devices'; devices: TelegramCallDevice[] }
  | { kind: 'metrics'; metrics: TelegramCallMetrics }
  | {
      kind: 'terminal';
      sessionId: string;
      reason: 'declined' | 'missed' | 'hung-up' | 'disconnected' | 'busy' | 'error';
      error?: string;
    };

export interface TelegramCallState {
  session: TelegramCallSession | null;
  participants: TelegramCallParticipant[];
  devices: TelegramCallDevice[];
  metrics: TelegramCallMetrics;
}

export interface ChatServiceEvent {
  source: 'telegram';
  kind: string;
  title: string;
  detail?: string;
}

export interface ResolvedDocument extends ChatDocument {
  filePath: string;
}

export type TelegramPickerItemKind = 'sticker' | 'gif';
export type TelegramStickerSetSource = 'recent' | 'favorite' | 'installed';

export interface TelegramPickerItem {
  id: string;
  kind: TelegramPickerItemKind;
  previewUrl: string;
  previewMimeType?: string;
  emoji?: string;
  setTitle?: string;
  animated?: boolean;
  width?: number;
  height?: number;
}

export interface TelegramStickerSetSummary {
  id: string;
  title: string;
  name?: string;
  source: TelegramStickerSetSource;
  thumbnailUrl?: string;
  stickerCount?: number;
}

export interface TelegramPickerQuery {
  kind: TelegramPickerItemKind;
  query?: string;
  emoji?: string;
  setId?: string;
  limit?: number;
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
  canBeEdited?: boolean;
  readByPeer?: boolean;
  forwardedFrom?: string;
  replyToMessageId?: string;
  replyToSender?: string;
  replyToText?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  imageUrl?: string;
  imageName?: string;
  imageSizeBytes?: number;
  imageDeferred?: boolean;
  videoUrl?: string;
  videoThumbnailUrl?: string;
  videoWidth?: number;
  videoHeight?: number;
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
  serviceEvent?: ChatServiceEvent;
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
  addPollOption?(chatId: string, messageId: string, text: string): Promise<boolean>;
  listTelegramStickerSets?(
    source: TelegramStickerSetSource,
  ): Promise<TelegramStickerSetSummary[]>;
  listTelegramPickerItems?(query: TelegramPickerQuery): Promise<TelegramPickerItem[]>;
  sendTelegramPickerItem?(
    chatId: string,
    item: TelegramPickerItem,
    replyToMessageId?: string,
  ): Promise<boolean>;
  sendImageMessage?(
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ): Promise<boolean>;
  sendImageAlbumMessage?(
    chatId: string,
    images: OutgoingAttachmentDocument[],
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
  editMessage?(chatId: string, messageId: string, text: string): Promise<boolean>;
  setReaction?(chatId: string, messageId: string, reaction: string): Promise<boolean>;
  forwardMessage?(fromChatId: string, toChatId: string, messageId: string): Promise<boolean>;
  deleteMessage?(chatId: string, messageId: string): Promise<boolean>;
  getTelegramCallState?(): Promise<TelegramCallState>;
  startTelegramCall?(chatId: string, isVideo: boolean): Promise<TelegramCallState>;
  answerTelegramCall?(isVideo: boolean): Promise<TelegramCallState>;
  declineTelegramCall?(): Promise<TelegramCallState>;
  hangUpTelegramCall?(): Promise<TelegramCallState>;
  joinTelegramGroupCall?(chatId: string, isVideo: boolean): Promise<TelegramCallState>;
  leaveTelegramGroupCall?(): Promise<TelegramCallState>;
  setTelegramCallMuted?(muted: boolean): Promise<TelegramCallState>;
  setTelegramCallVideoEnabled?(enabled: boolean): Promise<TelegramCallState>;
  setTelegramCallDevice?(
    kind: TelegramCallDevice['kind'],
    deviceId: string,
  ): Promise<TelegramCallState>;
  setTelegramParticipantVolume?(
    participantId: string,
    volume: number,
  ): Promise<TelegramCallState>;
  setTelegramVisibleVideoEndpoints?(endpointIds: string[]): Promise<void>;
  onTelegramCallUpdate?(handler: (event: TelegramCallUpdate) => void): () => void;
  onTelegramCallVideoFrame?(handler: (frame: TelegramCallVideoFrame) => void): () => void;
  onUpdate?(handler: (event: ConnectorUpdateEvent) => void): () => void;
}
