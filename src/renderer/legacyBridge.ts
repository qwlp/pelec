import type { ChatMessage, ChatSummary } from '../shared/connectors';
import type { AppActivity, AppMode, AppPane, NetworkId } from '../shared/types';
import type { PendingTelegramAttachment } from './features/telegram/media';

export interface LegacyCommandItem {
  id: string;
  label: string;
  group: 'actions' | 'mode' | 'network' | 'system';
}

export interface LegacyTelegramReplyPreview {
  sender: string;
  text: string;
}

export interface LegacyInstagramReplyPreview {
  sender: string;
  text: string;
}

export interface LegacyInstagramAttachment {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  dataUrl: string;
}

export interface LegacyTelegramForwardState {
  candidates: ChatSummary[];
  query: string;
  sending: boolean;
  visible: boolean;
}

export interface LegacyTelegramContextMenuState {
  messageId: string | null;
  visible: boolean;
  x: number;
  y: number;
}

export interface LegacyAuthPromptState {
  label: string;
  message: string;
  placeholder: string;
  secret: boolean;
  stepLabel: string | null;
  submitLabel: string;
  title: string;
  visible: boolean;
}

export interface LegacyQrAuthState {
  network: NetworkId;
  passwordRequired: boolean;
  qrLink: string | null;
  visible: boolean;
}

export type LegacyRenderableTelegramMessage = ChatMessage & { pendingState?: 'sending' };

export interface LegacyTelegramSnapshot {
  activeChatTitle: string;
  activeChatId: string | null;
  activeChatCanSend: boolean;
  chatListMinimized: boolean;
  contextMenu: LegacyTelegramContextMenuState;
  filteredChats: ChatSummary[];
  forward: LegacyTelegramForwardState;
  hasOlderMessages: boolean;
  imagePreviewUrl: string | null;
  loadError: string | null;
  loadingOlderMessages: boolean;
  loading: boolean;
  draftText: string;
  messageLoadError: string | null;
  messages: LegacyRenderableTelegramMessage[];
  messagesLoading: boolean;
  pendingAttachments: PendingTelegramAttachment[];
  replyPreview: LegacyTelegramReplyPreview | null;
  searchQuery: string;
  selectedChatId: string | null;
  selectedMessageId: string | null;
  voiceRecorderState: 'idle' | 'preparing' | 'recording' | 'sending' | 'unsupported';
}

export interface LegacyInstagramSnapshot {
  activeChatTitle: string;
  activeChatId: string | null;
  activeChatCanSend: boolean;
  draftText: string;
  filteredChats: ChatSummary[];
  loadError: string | null;
  loading: boolean;
  messageLoadError: string | null;
  messages: ChatMessage[];
  messagesLoading: boolean;
  pendingAttachments: LegacyInstagramAttachment[];
  realtimeStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  replyPreview: LegacyInstagramReplyPreview | null;
  searchQuery: string;
  selectedChatId: string | null;
  selectedMessageId: string | null;
}

export interface LegacyAppSnapshot {
  authPrompt: LegacyAuthPromptState | null;
  mode: AppMode;
  activeNetwork: NetworkId;
  activePane: AppPane;
  qrAuth: LegacyQrAuthState | null;
  instagram: LegacyInstagramSnapshot;
  telegram: LegacyTelegramSnapshot;
}

export interface LegacyAppBridgeApi {
  activateNetwork(network: NetworkId): void;
  activateInstagramChat(chatId: string): void;
  activateInstagramMessagesPane(): void;
  activateTelegramChat(chatId: string): void;
  activateTelegramMessagesPane(): void;
  selectTelegramMessage(messageId: string): void;
  selectInstagramMessage(messageId: string): void;
  activateSelection(): void;
  deleteSelection(): void;
  executeCommand(commandId: string): void;
  cancelAuthPrompt(): void;
  closeQrAuth(): void;
  focusSearch(): void;
  forwardTelegramMessageToChat(chatId: string): void;
  getCommands(): LegacyCommandItem[];
  getSnapshot(): LegacyAppSnapshot;
  handleEscape(): void;
  loadOlderTelegramMessages(): Promise<void>;
  movePane(direction: -1 | 1): void;
  moveSelection(direction: -1 | 1): void;
  moveSelectionByPage(direction: -1 | 1): void;
  moveSelectionToEdge(edge: 'first' | 'last'): void;
  openBrowser(): void;
  refresh(): void;
  reply(): void;
  openTelegramContextMenu(messageId: string, x: number, y: number): void;
  openTelegramImagePreview(url: string): void;
  appendInstagramFiles(files: File[]): void;
  appendTelegramFiles(files: File[]): void;
  clearInstagramReply(): void;
  clearTelegramReply(): void;
  closeTelegramContextMenu(): void;
  closeTelegramForwardMenu(): void;
  closeTelegramImagePreview(): void;
  copyTelegramMessage(messageId: string): void;
  copyTelegramImagePreview(): void;
  downloadTelegramImagePreview(): void;
  focusTelegramComposer(): void;
  openTelegramForwardMenu(messageId: string): void;
  refreshQrAuth(): void;
  removeTelegramAttachment(attachmentId: string): void;
  revealQrPassword(): void;
  removeInstagramAttachment(attachmentId: string): void;
  submitQrPassword(value: string): void;
  sendInstagramMessage(): void;
  submitAuthPrompt(value: string): void;
  setInstagramDraftValue(value: string): void;
  setInstagramSearchQuery(query: string): void;
  setTelegramForwardQuery(query: string): void;
  setTelegramSearchQuery(query: string): void;
  setTelegramDraftValue(value: string): void;
  setTelegramMessagesVisible(visible: boolean): void;
  sendTelegramMessage(): void;
  startTelegramVoiceRecording(pointerId?: number): void;
  stopTelegramVoiceRecording(): void;
  cancelTelegramVoiceRecording(): void;
  toggleSendBehavior(): 'enter' | 'mod-enter';
  setMode(mode: AppMode): void;
  startAuth(): void;
  subscribe(listener: (snapshot: LegacyAppSnapshot) => void): () => void;
}

export interface LegacyAppBridge {
  onActivityChange?(activity: AppActivity | null): void;
  onReady?(api: LegacyAppBridgeApi): void;
  onSnapshotChange?(snapshot: LegacyAppSnapshot): void;
}

export interface BootLegacyAppOptions {
  bridge?: LegacyAppBridge;
  disableDefaultKeyboardHandling?: boolean;
}
