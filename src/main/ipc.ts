import {
  clipboard,
  ipcMain,
  nativeImage,
  Notification,
  shell,
  type BrowserWindow,
} from 'electron';
import path from 'node:path';
import type {
  AuthSubmission,
  OutgoingAttachmentDocument,
} from '../shared/connectors';
import type { AppActivity, AppConfig, NetworkId } from '../shared/types';
import type { ConnectorManager } from './connectors/connectorManager';
import {
  copyResolvedDocumentToClipboard,
  saveResolvedDocumentToDownloads,
} from './documents';
import { showLinuxNotification } from './platform';

type IpcRegistrationContext = {
  getAppConfig: () => AppConfig | null;
  getConnectorManager: () => ConnectorManager | null;
  getMainWindow: () => BrowserWindow | null;
  emitAppActivity: (activity: AppActivity) => void;
};

export const registerIpcHandlers = ({
  getAppConfig,
  getConnectorManager,
  getMainWindow,
  emitAppActivity,
}: IpcRegistrationContext): void => {
  ipcMain.handle('app:get-config', async (): Promise<AppConfig> => {
    const appConfig = getAppConfig();
    if (!appConfig) {
      throw new Error('App config not ready');
    }
    return appConfig;
  });

  ipcMain.handle('connector:get-statuses', async () => {
    return getConnectorManager()?.getAllStatuses() ?? [];
  });

  ipcMain.handle('connector:start-auth', async (_event, network: NetworkId) => {
    const connectorManager = getConnectorManager();
    if (!connectorManager) {
      throw new Error('Connector manager not ready');
    }

    if (network === 'instagram') {
      console.info('[instagram-auth][ipc] start-auth request');
    }

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Auth start timed out for ${network}.`)), 15000);
    });

    try {
      const result = await Promise.race([connectorManager.startAuth(network), timeout]);
      if (network === 'instagram') {
        console.info('[instagram-auth][ipc] start-auth response', result);
      }
      return result;
    } catch (error) {
      if (network === 'instagram') {
        console.error('[instagram-auth][ipc] start-auth error', error);
      }
      throw error;
    }
  });

  ipcMain.handle(
    'connector:submit-auth',
    async (_event, network: NetworkId, payload: AuthSubmission) => {
      const connectorManager = getConnectorManager();
      if (!connectorManager) {
        throw new Error('Connector manager not ready');
      }

      if (network === 'instagram') {
        console.info('[instagram-auth][ipc] submit-auth request', {
          type: payload.type,
          valuePreview: payload.value.slice(0, 20),
        });
      }

      try {
        const result = await connectorManager.submitAuth(network, payload);
        if (network === 'instagram') {
          console.info('[instagram-auth][ipc] submit-auth response', {
            authState: result.authState,
            mode: result.mode,
            details: result.details,
            lastError: result.lastError,
          });
        }
        return result;
      } catch (error) {
        if (network === 'instagram') {
          console.error('[instagram-auth][ipc] submit-auth error', error);
        }
        throw error;
      }
    },
  );

  ipcMain.handle('connector:reset-auth', async (_event, network: NetworkId) => {
    const connectorManager = getConnectorManager();
    if (!connectorManager) {
      throw new Error('Connector manager not ready');
    }
    return connectorManager.resetAuth(network);
  });

  ipcMain.handle('connector:list-chats', async (_event, network: NetworkId) => {
    return (await getConnectorManager()?.listChats(network)) ?? [];
  });

  ipcMain.handle(
    'connector:list-messages',
    async (_event, network: NetworkId, chatId: string) => {
      return (await getConnectorManager()?.listMessages(network, chatId)) ?? [];
    },
  );

  ipcMain.handle(
    'connector:set-active-chat',
    async (_event, network: NetworkId, chatId?: string | null) => {
      await getConnectorManager()?.setActiveChat(network, chatId);
    },
  );

  ipcMain.handle(
    'connector:resolve-audio-url',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      return getConnectorManager()?.resolveAudioUrl(network, chatId, messageId);
    },
  );

  ipcMain.handle(
    'connector:resolve-video-url',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      return getConnectorManager()?.resolveVideoUrl(network, chatId, messageId);
    },
  );

  ipcMain.handle(
    'connector:download-document',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      const connectorManager = getConnectorManager();
      if (!connectorManager) {
        return undefined;
      }

      const activityId = `document-download:${network}:${chatId}:${messageId}:${Date.now()}`;
      emitAppActivity({
        id: activityId,
        label: 'Preparing download',
        detail: 'Fetching the document from Telegram…',
        indeterminate: true,
        state: 'running',
      });

      const document = await connectorManager.resolveDocument(network, chatId, messageId);
      if (!document) {
        emitAppActivity({
          id: activityId,
          label: 'Download failed',
          detail: 'Telegram did not return a document file.',
          state: 'error',
        });
        return undefined;
      }

      emitAppActivity({
        id: activityId,
        label: `Downloading ${document.fileName}`,
        detail: 'Saving into Downloads…',
        progress: 0,
        state: 'running',
      });

      try {
        const savedPath = await saveResolvedDocumentToDownloads(document, (progress) => {
          emitAppActivity({
            id: activityId,
            label: `Downloading ${document.fileName}`,
            detail: 'Saving into Downloads…',
            progress,
            state: 'running',
          });
        });

        if (!savedPath) {
          emitAppActivity({
            id: activityId,
            label: 'Download failed',
            detail: `Could not save ${document.fileName}.`,
            state: 'error',
          });
          return undefined;
        }

        emitAppActivity({
          id: activityId,
          label: `Downloaded ${document.fileName}`,
          detail: path.join('Downloads', path.basename(savedPath)),
          progress: 1,
          state: 'success',
        });
        return savedPath;
      } catch (error) {
        emitAppActivity({
          id: activityId,
          label: 'Download failed',
          detail: error instanceof Error ? error.message : `Could not save ${document.fileName}.`,
          state: 'error',
        });
        return undefined;
      }
    },
  );

  ipcMain.handle(
    'connector:forward-message',
    async (
      _event,
      network: NetworkId,
      fromChatId: string,
      toChatId: string,
      messageId: string,
    ) => {
      return (await getConnectorManager()?.forwardMessage(network, fromChatId, toChatId, messageId)) ?? false;
    },
  );

  ipcMain.handle(
    'connector:copy-document',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      const connectorManager = getConnectorManager();
      if (!connectorManager) {
        return false;
      }

      const activityId = `document-copy:${network}:${chatId}:${messageId}:${Date.now()}`;
      emitAppActivity({
        id: activityId,
        label: 'Preparing copy',
        detail:
          process.platform === 'linux'
            ? 'Building a Linux file-manager clipboard payload…'
            : 'Resolving the document file…',
        indeterminate: true,
        state: 'running',
      });

      const document = await connectorManager.resolveDocument(network, chatId, messageId);
      if (!document) {
        emitAppActivity({
          id: activityId,
          label: 'Copy failed',
          detail: 'Telegram did not return a document file.',
          state: 'error',
        });
        return false;
      }

      const copied = await copyResolvedDocumentToClipboard(document);
      emitAppActivity({
        id: activityId,
        label: copied ? `Copied ${document.fileName}` : 'Copy failed',
        detail: copied
          ? process.platform === 'linux'
            ? 'Linux file clipboard is ready.'
            : 'The document is ready on the system clipboard.'
          : process.platform === 'linux'
            ? 'Could not publish a Linux file clipboard payload.'
            : 'Could not copy the document to the clipboard.',
        progress: copied ? 1 : undefined,
        state: copied ? 'success' : 'error',
      });
      return copied;
    },
  );

  ipcMain.handle(
    'connector:send-message',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      text: string,
      replyToMessageId?: string,
    ) => {
      return (await getConnectorManager()?.sendMessage(network, chatId, text, replyToMessageId)) ?? false;
    },
  );

  ipcMain.handle(
    'connector:send-image',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      dataUrl: string,
      caption?: string,
      replyToMessageId?: string,
    ) => {
      return (
        (await getConnectorManager()?.sendImageMessage(
          network,
          chatId,
          dataUrl,
          caption,
          replyToMessageId,
        )) ?? false
      );
    },
  );

  ipcMain.handle(
    'connector:send-document',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      document: OutgoingAttachmentDocument,
      caption?: string,
      replyToMessageId?: string,
    ) => {
      return (
        (await getConnectorManager()?.sendDocumentMessage(
          network,
          chatId,
          document,
          caption,
          replyToMessageId,
        )) ?? false
      );
    },
  );

  ipcMain.handle(
    'connector:send-voice',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      document: OutgoingAttachmentDocument,
      replyToMessageId?: string,
    ) => {
      return (
        (await getConnectorManager()?.sendVoiceMessage(
          network,
          chatId,
          document,
          replyToMessageId,
        )) ?? false
      );
    },
  );

  ipcMain.handle(
    'connector:delete-message',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      return (await getConnectorManager()?.deleteMessage(network, chatId, messageId)) ?? false;
    },
  );

  ipcMain.handle('app:open-external', async (_event, url: string): Promise<boolean> => {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        return false;
      }
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:open-path', async (_event, filePath: string): Promise<boolean> => {
    const normalized = filePath.trim();
    if (!normalized) {
      return false;
    }

    try {
      const error = await shell.openPath(normalized);
      return !error;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:copy-image', async (_event, dataUrl: string): Promise<boolean> => {
    const value = dataUrl.trim();
    if (!value.startsWith('data:image/')) {
      return false;
    }

    try {
      const image = nativeImage.createFromDataURL(value);
      if (image.isEmpty()) {
        return false;
      }
      clipboard.writeImage(image);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(
    'app:notify',
    async (_event, payload: { title: string; body: string; silent?: boolean }): Promise<boolean> => {
      const title = payload.title.trim();
      const body = payload.body.trim();
      if (!title || !body) {
        return false;
      }

      const safeTitle = title.slice(0, 140);
      const safeBody = body.slice(0, 500);

      if (showLinuxNotification(safeTitle, safeBody)) {
        return true;
      }

      if (!Notification.isSupported()) {
        return false;
      }

      try {
        const notification = new Notification({
          title: safeTitle,
          body: safeBody,
          silent: payload.silent ?? false,
        });
        notification.on('click', () => {
          const mainWindow = getMainWindow();
          if (!mainWindow) {
            return;
          }
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();
        });
        notification.show();
        return true;
      } catch {
        return false;
      }
    },
  );
};
