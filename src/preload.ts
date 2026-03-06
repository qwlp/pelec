import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthStartResult,
  AuthSubmission,
  ChatMessage,
  ChatSummary,
  ConnectorUpdateEvent,
  ConnectorStatus,
} from './shared/connectors';
import type { AppConfig, NetworkId } from './shared/types';

const api = {
  getConfig: () => ipcRenderer.invoke('app:get-config') as Promise<AppConfig>,
  showNotification: (title: string, body: string, silent?: boolean) =>
    ipcRenderer.invoke('app:notify', { title, body, silent }) as Promise<boolean>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<boolean>,
  copyImageToClipboard: (dataUrl: string) =>
    ipcRenderer.invoke('app:copy-image', dataUrl) as Promise<boolean>,
  getConnectorStatuses: () =>
    ipcRenderer.invoke('connector:get-statuses') as Promise<ConnectorStatus[]>,
  startConnectorAuth: (network: NetworkId) =>
    ipcRenderer.invoke('connector:start-auth', network) as Promise<AuthStartResult>,
  submitConnectorAuth: (network: NetworkId, payload: AuthSubmission) =>
    ipcRenderer.invoke('connector:submit-auth', network, payload) as Promise<ConnectorStatus>,
  resetConnectorAuth: (network: NetworkId) =>
    ipcRenderer.invoke('connector:reset-auth', network) as Promise<ConnectorStatus>,
  listConnectorChats: (network: NetworkId) =>
    ipcRenderer.invoke('connector:list-chats', network) as Promise<ChatSummary[]>,
  listConnectorMessages: (network: NetworkId, chatId: string) =>
    ipcRenderer.invoke('connector:list-messages', network, chatId) as Promise<ChatMessage[]>,
  setConnectorActiveChat: (network: NetworkId, chatId?: string | null) =>
    ipcRenderer.invoke('connector:set-active-chat', network, chatId) as Promise<void>,
  resolveConnectorAudioUrl: (network: NetworkId, chatId: string, messageId: string) =>
    ipcRenderer.invoke(
      'connector:resolve-audio-url',
      network,
      chatId,
      messageId,
    ) as Promise<string | undefined>,
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
};

contextBridge.exposeInMainWorld('pelec', api);

declare global {
  interface Window {
    pelec: typeof api;
  }
}
