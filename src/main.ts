import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeImage, Notification, shell } from 'electron';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import started from 'electron-squirrel-startup';
import type { AuthSubmission, ConnectorUpdateEvent } from './shared/connectors';
import type { AppConfig, NetworkId } from './shared/types';
import { ConnectorManager } from './main/connectors/connectorManager';

if (started) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const loadEnv = (): void => {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      break;
    }
  }
};

loadEnv();

if (!process.env.TELEGRAM_API_ID) {
  process.env.TELEGRAM_API_ID = '35106525';
}

if (!process.env.TELEGRAM_API_HASH) {
  process.env.TELEGRAM_API_HASH = '90e7c85f263db08ae995ea0de68b4523';
}

const appConfig: AppConfig = {
  version: app.getVersion(),
  networks: [
    {
      id: 'telegram',
      name: 'Telegram',
      partition: 'persist:telegram',
      homeUrl: 'about:blank',
      loginHint: 'TDLib native auth: phone number, login code, and 2FA password if needed.',
      supportLevel: 'native-web',
    },
    {
      id: 'instagram',
      name: 'Instagram',
      partition: 'persist:instagram',
      homeUrl: 'https://www.instagram.com/direct/inbox/',
      loginHint: 'Use the embedded Instagram web app for DMs inside the app shell.',
      supportLevel: 'native-web',
    },
  ],
  shortcuts: {
    forceNormalMode: 'CommandOrControl+[',
  },
};

let connectorManager: ConnectorManager | null = null;
let mainWindow: BrowserWindow | null = null;
let appShutdownStarted = false;

const showLinuxNotification = (title: string, body: string): boolean => {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    const result = spawnSync(
      'notify-send',
      ['-a', app.getName(), '-t', '5000', title, body],
      { stdio: 'ignore' },
    );
    return result.status === 0;
  } catch {
    return false;
  }
};

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1016',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
};

app.whenReady().then(() => {
  connectorManager = new ConnectorManager(appConfig, app.getPath('userData'));
  connectorManager.onConnectorUpdate((event: ConnectorUpdateEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('connector:update', event);
    }
  });
  void connectorManager.initAll();

  mainWindow = createWindow();

  const shortcut = appConfig.shortcuts.forceNormalMode;
  const registered = globalShortcut.register(shortcut, () => {
    mainWindow?.webContents.send('app:force-normal-mode');
  });

  if (!registered) {
    // Failing to register is not fatal. Renderer still handles Escape in-app.
    console.warn(`Failed to register shortcut: ${shortcut}`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

const shutdownApp = async (): Promise<void> => {
  if (appShutdownStarted) {
    return;
  }
  appShutdownStarted = true;
  globalShortcut.unregisterAll();
  try {
    await connectorManager?.shutdownAll();
  } catch (error) {
    console.warn('Connector shutdown failed during app quit.', error);
  }
  app.exit(0);
};

app.on('before-quit', (event) => {
  if (appShutdownStarted) {
    return;
  }
  event.preventDefault();
  void shutdownApp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:get-config', async (): Promise<AppConfig> => appConfig);

ipcMain.handle('connector:get-statuses', async () => {
  if (!connectorManager) {
    return [];
  }
  return connectorManager.getAllStatuses();
});

ipcMain.handle('connector:start-auth', async (_event, network: NetworkId) => {
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
  if (!connectorManager) {
    throw new Error('Connector manager not ready');
  }
  return connectorManager.resetAuth(network);
});

ipcMain.handle('connector:list-chats', async (_event, network: NetworkId) => {
  if (!connectorManager) {
    return [];
  }
  return connectorManager.listChats(network);
});

ipcMain.handle(
  'connector:list-messages',
  async (_event, network: NetworkId, chatId: string) => {
    if (!connectorManager) {
      return [];
    }
    return connectorManager.listMessages(network, chatId);
  },
);

ipcMain.handle(
  'connector:set-active-chat',
  async (_event, network: NetworkId, chatId?: string | null) => {
    if (!connectorManager) {
      return;
    }
    await connectorManager.setActiveChat(network, chatId);
  },
);

ipcMain.handle(
  'connector:resolve-audio-url',
  async (_event, network: NetworkId, chatId: string, messageId: string) => {
    if (!connectorManager) {
      return undefined;
    }
    return connectorManager.resolveAudioUrl(network, chatId, messageId);
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
    if (!connectorManager) {
      return false;
    }
    return connectorManager.sendMessage(network, chatId, text, replyToMessageId);
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
    if (!connectorManager) {
      return false;
    }
    return connectorManager.sendImageMessage(
      network,
      chatId,
      dataUrl,
      caption,
      replyToMessageId,
    );
  },
);

ipcMain.handle(
  'connector:delete-message',
  async (_event, network: NetworkId, chatId: string, messageId: string) => {
    if (!connectorManager) {
      return false;
    }
    return connectorManager.deleteMessage(network, chatId, messageId);
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
