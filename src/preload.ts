import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthStartResult,
  AuthSubmission,
  ChatMessage,
  ConnectorProfile,
  ConnectorProfileUpdate,
  ChatSummary,
  ConnectorUpdateEvent,
  ConnectorStatus,
  ListMessagesOptions,
  OutgoingAttachmentDocument,
  TelegramPickerItem,
  TelegramPickerQuery,
  TelegramCallDevice,
  TelegramCallState,
  TelegramCallUpdate,
  TelegramCallVideoFrame,
  TelegramStickerSetSource,
  TelegramStickerSetSummary,
} from './shared/connectors';
import type { AppActivity, AppConfig, NetworkId, RuntimeDiagnostics, UserConfig } from './shared/types';

let telegramVideoChannelSequence = 0;

const api = {
  getConfig: () => ipcRenderer.invoke('app:get-config') as Promise<AppConfig>,
  saveConfig: (config: UserConfig) =>
    ipcRenderer.invoke('app:save-config', config) as Promise<AppConfig>,
  listInstalledFonts: () =>
    ipcRenderer.invoke('app:list-installed-fonts') as Promise<string[]>,
  getRuntimeDiagnostics: () =>
    ipcRenderer.invoke('app:get-runtime-diagnostics') as Promise<RuntimeDiagnostics | null>,
  showNotification: (title: string, body: string, silent?: boolean) =>
    ipcRenderer.invoke('app:notify', { title, body, silent }) as Promise<boolean>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<boolean>,
  openPath: (filePath: string) => ipcRenderer.invoke('app:open-path', filePath) as Promise<boolean>,
  clearAppCache: () => ipcRenderer.invoke('app:clear-cache') as Promise<boolean>,
  getAppCacheSize: () => ipcRenderer.invoke('app:get-cache-size') as Promise<number>,
  copyImageToClipboard: (dataUrl: string) =>
    ipcRenderer.invoke('app:copy-image', dataUrl) as Promise<boolean>,
  copyTextToClipboard: (text: string) =>
    ipcRenderer.invoke('app:copy-text', text) as Promise<boolean>,
  getConnectorStatuses: () =>
    ipcRenderer.invoke('connector:get-statuses') as Promise<ConnectorStatus[]>,
  getTelegramCallState: () =>
    ipcRenderer.invoke('telegram-call:get-state') as Promise<TelegramCallState>,
  startTelegramCall: (chatId: string, isVideo: boolean) =>
    ipcRenderer.invoke('telegram-call:start', chatId, isVideo) as Promise<TelegramCallState>,
  answerTelegramCall: (isVideo: boolean) =>
    ipcRenderer.invoke('telegram-call:answer', isVideo) as Promise<TelegramCallState>,
  declineTelegramCall: () =>
    ipcRenderer.invoke('telegram-call:decline') as Promise<TelegramCallState>,
  hangUpTelegramCall: () =>
    ipcRenderer.invoke('telegram-call:hang-up') as Promise<TelegramCallState>,
  joinTelegramGroupCall: (chatId: string, isVideo: boolean) =>
    ipcRenderer.invoke('telegram-call:join-group', chatId, isVideo) as Promise<TelegramCallState>,
  leaveTelegramGroupCall: () =>
    ipcRenderer.invoke('telegram-call:leave-group') as Promise<TelegramCallState>,
  setTelegramCallMuted: (muted: boolean) =>
    ipcRenderer.invoke('telegram-call:set-muted', muted) as Promise<TelegramCallState>,
  setTelegramCallVideoEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('telegram-call:set-video', enabled) as Promise<TelegramCallState>,
  setTelegramCallDevice: (kind: TelegramCallDevice['kind'], deviceId: string) =>
    ipcRenderer.invoke(
      'telegram-call:set-device',
      kind,
      deviceId,
    ) as Promise<TelegramCallState>,
  setTelegramParticipantVolume: (participantId: string, volume: number) =>
    ipcRenderer.invoke(
      'telegram-call:set-participant-volume',
      participantId,
      volume,
    ) as Promise<TelegramCallState>,
  setTelegramVisibleVideoEndpoints: (endpointIds: string[]) =>
    ipcRenderer.invoke('telegram-call:set-visible-video-endpoints', endpointIds) as Promise<void>,
  onTelegramCallUpdate: (handler: (event: TelegramCallUpdate) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TelegramCallUpdate) =>
      handler(payload);
    ipcRenderer.on('telegram-call:update', wrapped);
    return () => ipcRenderer.removeListener('telegram-call:update', wrapped);
  },
  onTelegramCallVideoFrame: (handler: (frame: TelegramCallVideoFrame) => void) => {
    const requestId = String(++telegramVideoChannelSequence);
    let port: MessagePort | null = null;
    const receivePort = (event: Electron.IpcRendererEvent, receivedRequestId: string) => {
      if (receivedRequestId !== requestId || !event.ports[0]) {
        return;
      }
      ipcRenderer.removeListener('telegram-call:video-channel', receivePort);
      port = event.ports[0];
      port.onmessage = (message) => {
        const frame = message.data as Omit<TelegramCallVideoFrame, 'data'> & {
          data: ArrayBuffer;
        };
        handler({
          ...frame,
          data: new Uint8Array(frame.data),
        });
        port?.postMessage('ack');
      };
      port.start();
    };
    ipcRenderer.on('telegram-call:video-channel', receivePort);
    ipcRenderer.send('telegram-call:open-video-channel', requestId);
    return () => {
      ipcRenderer.removeListener('telegram-call:video-channel', receivePort);
      port?.close();
      port = null;
    };
  },
  getConnectorProfile: (network: NetworkId) =>
    ipcRenderer.invoke('connector:get-profile', network) as Promise<ConnectorProfile | null>,
  updateConnectorProfile: (network: NetworkId, profile: ConnectorProfileUpdate) =>
    ipcRenderer.invoke('connector:update-profile', network, profile) as Promise<ConnectorProfile | null>,
  startConnectorAuth: (network: NetworkId) =>
    ipcRenderer.invoke('connector:start-auth', network) as Promise<AuthStartResult>,
  submitConnectorAuth: (network: NetworkId, payload: AuthSubmission) =>
    ipcRenderer.invoke('connector:submit-auth', network, payload) as Promise<ConnectorStatus>,
  resetConnectorAuth: (network: NetworkId) =>
    ipcRenderer.invoke('connector:reset-auth', network) as Promise<ConnectorStatus>,
  listConnectorChats: (network: NetworkId) =>
    ipcRenderer.invoke('connector:list-chats', network) as Promise<ChatSummary[]>,
  listConnectorMessages: (network: NetworkId, chatId: string, options?: ListMessagesOptions) =>
    ipcRenderer.invoke('connector:list-messages', network, chatId, options) as Promise<ChatMessage[]>,
  markConnectorChatRead: (network: NetworkId, chatId: string, messageIds?: string[]) =>
    ipcRenderer.invoke('connector:mark-chat-read', network, chatId, messageIds) as Promise<void>,
  setConnectorActiveChat: (network: NetworkId, chatId?: string | null) =>
    ipcRenderer.invoke('connector:set-active-chat', network, chatId) as Promise<void>,
  resolveConnectorAudioUrl: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke(
      'connector:resolve-audio-url',
      network,
      chatId,
      messageId,
    ) as Promise<string | undefined>,
  resolveConnectorImageUrl: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke(
      'connector:resolve-image-url',
      network,
      chatId,
      messageId,
    ) as Promise<string | undefined>,
  resolveConnectorVideoUrl: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke(
      'connector:resolve-video-url',
      network,
      chatId,
      messageId,
    ) as Promise<string | undefined>,
  downloadConnectorDocument: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke(
      'connector:download-document',
      network,
      chatId,
      messageId,
    ) as Promise<string | undefined>,
  copyConnectorDocument: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke('connector:copy-document', network, chatId, messageId) as Promise<boolean>,
  openConnectorDocument: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke('connector:open-document', network, chatId, messageId) as Promise<boolean>,
  answerConnectorPoll: (
    network: NetworkId,
    chatId: string,
    messageId: string,
    optionIds: number[],
  ) =>
    ipcRenderer.invoke(
      'connector:answer-poll',
      network,
      chatId,
      messageId,
      optionIds,
    ) as Promise<boolean>,
  listTelegramStickerSets: (network: NetworkId, source: TelegramStickerSetSource) =>
    ipcRenderer.invoke(
      'connector:list-telegram-sticker-sets',
      network,
      source,
    ) as Promise<TelegramStickerSetSummary[]>,
  listTelegramPickerItems: (network: NetworkId, query: TelegramPickerQuery) =>
    ipcRenderer.invoke(
      'connector:list-telegram-picker-items',
      network,
      query,
    ) as Promise<TelegramPickerItem[]>,
  sendTelegramPickerItem: (
    network: NetworkId,
    chatId: string,
    item: TelegramPickerItem,
    replyToMessageId?: string,
  ) =>
    ipcRenderer.invoke(
      'connector:send-telegram-picker-item',
      network,
      chatId,
      item,
      replyToMessageId,
    ) as Promise<boolean>,
  sendConnectorMessage: (
    network: NetworkId,
    chatId: string,
    text: string,
    replyToMessageId?: string,
  ) =>
    ipcRenderer.invoke(
      'connector:send-message',
      network,
      chatId,
      text,
      replyToMessageId,
    ) as Promise<boolean>,
  editConnectorMessage: (network: NetworkId, chatId: string, messageId: string, text: string) =>
    ipcRenderer.invoke('connector:edit-message', network, chatId, messageId, text) as Promise<boolean>,
  sendConnectorImage: (
    network: NetworkId,
    chatId: string,
    dataUrl: string,
    caption?: string,
    replyToMessageId?: string,
  ) =>
    ipcRenderer.invoke(
      'connector:send-image',
      network,
      chatId,
      dataUrl,
      caption,
      replyToMessageId,
    ) as Promise<boolean>,
  sendConnectorDocument: (
    network: NetworkId,
    chatId: string,
    document: OutgoingAttachmentDocument,
    caption?: string,
    replyToMessageId?: string,
  ) =>
    ipcRenderer.invoke(
      'connector:send-document',
      network,
      chatId,
      document,
      caption,
      replyToMessageId,
    ) as Promise<boolean>,
  sendConnectorVoice: (
    network: NetworkId,
    chatId: string,
    document: OutgoingAttachmentDocument,
    replyToMessageId?: string,
  ) =>
    ipcRenderer.invoke(
      'connector:send-voice',
      network,
      chatId,
      document,
      replyToMessageId,
    ) as Promise<boolean>,
  forwardConnectorMessage: (
    network: NetworkId,
    fromChatId: string,
    toChatId: string,
    messageId: string,
  ) =>
    ipcRenderer.invoke(
      'connector:forward-message',
      network,
      fromChatId,
      toChatId,
      messageId,
    ) as Promise<boolean>,
  deleteConnectorMessage: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke('connector:delete-message', network, chatId, messageId) as Promise<boolean>,
  onConnectorUpdate: (handler: (event: ConnectorUpdateEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ConnectorUpdateEvent) =>
      handler(payload);
    ipcRenderer.on('connector:update', wrapped);
    return () => ipcRenderer.removeListener('connector:update', wrapped);
  },
  onForceNormalMode: (handler: () => void) => {
    const wrapped = () => handler();
    ipcRenderer.on('app:force-normal-mode', wrapped);
    return () => ipcRenderer.removeListener('app:force-normal-mode', wrapped);
  },
  onActivateNetwork: (handler: (network: NetworkId) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: NetworkId) =>
      handler(payload);
    ipcRenderer.on('app:activate-network', wrapped);
    return () => ipcRenderer.removeListener('app:activate-network', wrapped);
  },
  onOpenCommandPalette: (handler: () => void) => {
    const wrapped = () => handler();
    ipcRenderer.on('app:open-command-palette', wrapped);
    return () => ipcRenderer.removeListener('app:open-command-palette', wrapped);
  },
  onOpenKeyboardHelp: (handler: () => void) => {
    const wrapped = () => handler();
    ipcRenderer.on('app:open-keyboard-help', wrapped);
    return () => ipcRenderer.removeListener('app:open-keyboard-help', wrapped);
  },
  onAppActivity: (handler: (activity: AppActivity) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppActivity) =>
      handler(payload);
    ipcRenderer.on('app:activity', wrapped);
    return () => ipcRenderer.removeListener('app:activity', wrapped);
  },
};

contextBridge.exposeInMainWorld('pelec', api);

declare global {
  interface Window {
    pelec: typeof api;
  }
}
