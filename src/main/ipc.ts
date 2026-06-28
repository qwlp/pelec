import {
  app,
  clipboard,
  ipcMain,
  nativeImage,
  MessageChannelMain,
  Notification,
  shell,
  type BrowserWindow,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AuthSubmission,
  ConnectorProfileUpdate,
  ListMessagesOptions,
  OutgoingAttachmentDocument,
  TelegramPickerItem,
  TelegramPickerQuery,
  TelegramCallDevice,
  TelegramCallVideoFrame,
  TelegramStickerSetSource,
} from '../shared/connectors';
import type { AppActivity, AppConfig, NetworkId, RuntimeDiagnostics } from '../shared/types';
import type { ConnectorManager } from './connectors/connectorManager';
import {
  copyResolvedDocumentToClipboard,
  openResolvedDocumentInDefaultApp,
  saveResolvedDocumentToDownloads,
} from './documents';
import { PELEC_MEDIA_SCHEME } from './config';
import { listInstalledFonts } from './installedFonts';
import { showLinuxNotification } from './platform';
import { saveUserConfig } from './userConfig';

type IpcRegistrationContext = {
  getAppConfig: () => AppConfig | null;
  getConnectorManager: () => ConnectorManager | null;
  getMainWindow: () => BrowserWindow | null;
  setAppConfig: (config: AppConfig) => void;
  emitAppActivity: (activity: AppActivity) => void;
};

const createClipboardImageFromSource = (source: string): Electron.NativeImage | null => {
  const value = source.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith('data:image/')) {
    const image = nativeImage.createFromDataURL(value);
    return image.isEmpty() ? null : image;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== `${PELEC_MEDIA_SCHEME}:`) {
      return null;
    }

    const localPath = url.searchParams.get('path')?.trim();
    if (!localPath || !fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
      return null;
    }

    const image = nativeImage.createFromPath(localPath);
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
};

export const registerIpcHandlers = ({
  getAppConfig,
  getConnectorManager,
  getMainWindow,
  setAppConfig,
  emitAppActivity,
}: IpcRegistrationContext): void => {
  ipcMain.on('telegram-call:open-video-channel', (event, requestId: string) => {
    const manager = getConnectorManager();
    if (!manager) {
      return;
    }
    const { port1, port2 } = new MessageChannelMain();
    let inFlight = false;
    let latestFrame: TelegramCallVideoFrame | null = null;

    const sendFrame = (frame: TelegramCallVideoFrame) => {
      const data = frame.data.buffer.slice(
        frame.data.byteOffset,
        frame.data.byteOffset + frame.data.byteLength,
      );
      inFlight = true;
      port1.postMessage({
        endpointId: frame.endpointId,
        width: frame.width,
        height: frame.height,
        timestamp: frame.timestamp,
        data,
      });
    };

    const unsubscribe = manager.onTelegramCallVideoFrame((frame) => {
      if (inFlight) {
        latestFrame = frame;
        return;
      }
      sendFrame(frame);
    });

    port1.on('message', ({ data }) => {
      if (data !== 'ack') {
        return;
      }
      inFlight = false;
      if (latestFrame) {
        const frame = latestFrame;
        latestFrame = null;
        sendFrame(frame);
      }
    });
    port1.on('close', unsubscribe);
    port1.start();
    event.senderFrame.postMessage(
      'telegram-call:video-channel',
      requestId,
      [port2],
    );
  });

  ipcMain.handle('app:get-config', async (): Promise<AppConfig> => {
    const appConfig = getAppConfig();
    if (!appConfig) {
      throw new Error('App config not ready');
    }
    return appConfig;
  });

  ipcMain.handle('app:save-config', async (_event, userConfig: AppConfig['userConfig']) => {
    const current = getAppConfig();
    if (!current) {
      throw new Error('App config not ready');
    }
    await saveUserConfig(current.configPath, userConfig);
    const next = { ...current, shortcuts: userConfig.shortcuts, userConfig };
    setAppConfig(next);
    return next;
  });

  ipcMain.handle('app:get-runtime-diagnostics', async (): Promise<RuntimeDiagnostics | null> => {
    if (!app.isPackaged && process.env.NODE_ENV !== 'production') {
      return {
        appVersion: app.getVersion(),
        chromeVersion: process.versions.chrome ?? '',
        electronVersion: process.versions.electron ?? '',
        nodeVersion: process.versions.node ?? '',
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        memoryUsage: process.memoryUsage(),
      };
    }

    return null;
  });

  ipcMain.handle('app:list-installed-fonts', listInstalledFonts);

  ipcMain.handle('app:clear-cache', async (): Promise<boolean> => {
    const mainWindow = getMainWindow();
    const session = mainWindow?.webContents.session;
    if (!session) {
      return false;
    }

    await Promise.all([
      session.clearCache(),
      session.clearStorageData(),
    ]);
    return true;
  });

  ipcMain.handle('app:get-cache-size', async (): Promise<number> => {
    const mainWindow = getMainWindow();
    const session = mainWindow?.webContents.session;
    if (!session) {
      return 0;
    }

    return session.getCacheSize();
  });

  ipcMain.handle('connector:get-statuses', async () => {
    return getConnectorManager()?.getAllStatuses() ?? [];
  });

  ipcMain.handle('telegram-call:get-state', async () => {
    return getConnectorManager()?.getTelegramCallState();
  });

  ipcMain.handle(
    'telegram-call:start',
    async (_event, chatId: string, isVideo: boolean) => {
      const manager = getConnectorManager();
      if (!manager) throw new Error('Connector manager not ready');
      return manager.startTelegramCall(chatId, isVideo);
    },
  );

  ipcMain.handle('telegram-call:answer', async (_event, isVideo: boolean) => {
    const manager = getConnectorManager();
    if (!manager) throw new Error('Connector manager not ready');
    return manager.answerTelegramCall(isVideo);
  });

  ipcMain.handle('telegram-call:decline', async () => {
    const manager = getConnectorManager();
    if (!manager) throw new Error('Connector manager not ready');
    return manager.declineTelegramCall();
  });

  ipcMain.handle('telegram-call:hang-up', async () => {
    const manager = getConnectorManager();
    if (!manager) throw new Error('Connector manager not ready');
    return manager.hangUpTelegramCall();
  });

  ipcMain.handle(
    'telegram-call:join-group',
    async (_event, chatId: string, isVideo: boolean) => {
      const manager = getConnectorManager();
      if (!manager) throw new Error('Connector manager not ready');
      return manager.joinTelegramGroupCall(chatId, isVideo);
    },
  );

  ipcMain.handle('telegram-call:leave-group', async () => {
    const manager = getConnectorManager();
    if (!manager) throw new Error('Connector manager not ready');
    return manager.leaveTelegramGroupCall();
  });

  ipcMain.handle('telegram-call:set-muted', async (_event, muted: boolean) => {
    const manager = getConnectorManager();
    if (!manager) throw new Error('Connector manager not ready');
    return manager.setTelegramCallMuted(muted);
  });

  ipcMain.handle('telegram-call:set-video', async (_event, enabled: boolean) => {
    const manager = getConnectorManager();
    if (!manager) throw new Error('Connector manager not ready');
    return manager.setTelegramCallVideoEnabled(enabled);
  });

  ipcMain.handle(
    'telegram-call:set-device',
    async (_event, kind: TelegramCallDevice['kind'], deviceId: string) => {
      const manager = getConnectorManager();
      if (!manager) throw new Error('Connector manager not ready');
      return manager.setTelegramCallDevice(kind, deviceId);
    },
  );

  ipcMain.handle(
    'telegram-call:set-participant-volume',
    async (_event, participantId: string, volume: number) => {
      const manager = getConnectorManager();
      if (!manager) throw new Error('Connector manager not ready');
      return manager.setTelegramParticipantVolume(participantId, volume);
    },
  );

  ipcMain.handle(
    'telegram-call:set-visible-video-endpoints',
    async (_event, endpointIds: string[]) => {
      await getConnectorManager()?.setTelegramVisibleVideoEndpoints(endpointIds);
    },
  );

  ipcMain.handle('connector:get-profile', async (_event, network: NetworkId) => {
    return (await getConnectorManager()?.getProfile(network)) ?? null;
  });

  ipcMain.handle(
    'connector:update-profile',
    async (_event, network: NetworkId, profile: ConnectorProfileUpdate) => {
      return (await getConnectorManager()?.updateProfile(network, profile)) ?? null;
    },
  );

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
    async (_event, network: NetworkId, chatId: string, options?: ListMessagesOptions) => {
      return (await getConnectorManager()?.listMessages(network, chatId, options)) ?? [];
    },
  );

  ipcMain.handle(
    'connector:mark-chat-read',
    async (_event, network: NetworkId, chatId: string, messageIds?: string[]) => {
      await getConnectorManager()?.markChatRead(network, chatId, messageIds);
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
    'connector:resolve-image-url',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      return getConnectorManager()?.resolveImageUrl(network, chatId, messageId);
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
    'connector:answer-poll',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      messageId: string,
      optionIds: number[],
    ) => {
      return (await getConnectorManager()?.answerPoll(network, chatId, messageId, optionIds)) ?? false;
    },
  );

  ipcMain.handle(
    'connector:add-poll-option',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      messageId: string,
      text: string,
    ) => {
      return (await getConnectorManager()?.addPollOption(network, chatId, messageId, text)) ?? false;
    },
  );

  ipcMain.handle(
    'connector:list-telegram-sticker-sets',
    async (_event, network: NetworkId, source: TelegramStickerSetSource) => {
      return (await getConnectorManager()?.listTelegramStickerSets(network, source)) ?? [];
    },
  );

  ipcMain.handle(
    'connector:list-telegram-picker-items',
    async (_event, network: NetworkId, query: TelegramPickerQuery) => {
      return (await getConnectorManager()?.listTelegramPickerItems(network, query)) ?? [];
    },
  );

  ipcMain.handle(
    'connector:send-telegram-picker-item',
    async (
      _event,
      network: NetworkId,
      chatId: string,
      item: TelegramPickerItem,
      replyToMessageId?: string,
    ) => {
      return (
        (await getConnectorManager()?.sendTelegramPickerItem(
          network,
          chatId,
          item,
          replyToMessageId,
        )) ?? false
      );
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
    'connector:open-document',
    async (_event, network: NetworkId, chatId: string, messageId: string) => {
      const connectorManager = getConnectorManager();
      if (!connectorManager) {
        return false;
      }

      const activityId = `document-open:${network}:${chatId}:${messageId}:${Date.now()}`;
      emitAppActivity({
        id: activityId,
        label: 'Preparing document',
        detail: 'Resolving the document file…',
        indeterminate: true,
        state: 'running',
      });

      const document = await connectorManager.resolveDocument(network, chatId, messageId);
      if (!document) {
        emitAppActivity({
          id: activityId,
          label: 'Open failed',
          detail: 'Telegram did not return a document file.',
          state: 'error',
        });
        return false;
      }

      const opened = await openResolvedDocumentInDefaultApp(document);
      emitAppActivity({
        id: activityId,
        label: opened ? 'Opened' : 'Open failed',
        detail: opened ? undefined : `Could not open ${document.fileName}.`,
        progress: opened ? 1 : undefined,
        state: opened ? 'success' : 'error',
      });
      return opened;
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
    'connector:edit-message',
    async (_event, network: NetworkId, chatId: string, messageId: string, text: string) => {
      return (await getConnectorManager()?.editMessage(network, chatId, messageId, text)) ?? false;
    },
  );

  ipcMain.handle(
    'connector:set-reaction',
    async (_event, network: NetworkId, chatId: string, messageId: string, reaction: string) => {
      return (await getConnectorManager()?.setReaction(network, chatId, messageId, reaction)) ?? false;
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

  ipcMain.handle('app:copy-image', async (_event, source: string): Promise<boolean> => {
    try {
      const image = createClipboardImageFromSource(source);
      if (!image) {
        return false;
      }
      clipboard.writeImage(image);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:copy-text', async (_event, text: string): Promise<boolean> => {
    if (typeof text !== 'string' || !text) {
      return false;
    }

    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:read-clipboard-image', async (): Promise<string | undefined> => {
    try {
      const image = clipboard.readImage();
      return image.isEmpty() ? undefined : image.toDataURL();
    } catch {
      return undefined;
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
