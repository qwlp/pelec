import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
} from 'electron';
import dotenv from 'dotenv';
import fs, { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import type { AuthSubmission, ConnectorUpdateEvent, ResolvedDocument } from './shared/connectors';
import type { AppActivity, AppConfig, NetworkId } from './shared/types';
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

const resolveNetworkShortcutTarget = (input: Electron.Input): NetworkId | null => {
  if (
    input.type !== 'keyDown' ||
    !input.alt ||
    input.control ||
    input.meta ||
    input.shift
  ) {
    return null;
  }

  if (input.key === '1') {
    return 'telegram';
  }

  if (input.key === '2') {
    return 'instagram';
  }

  return null;
};

const wireNetworkShortcutHandling = (contents: Electron.WebContents): void => {
  contents.on('before-input-event', (event, input) => {
    const target = resolveNetworkShortcutTarget(input);
    if (!target) {
      return;
    }

    event.preventDefault();
    mainWindow?.webContents.send('app:activate-network', target);
  });
};

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

const emitAppActivity = (activity: AppActivity): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app:activity', activity);
  }
};

const commandExists = (command: string): boolean => {
  try {
    return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};

const writeLinuxClipboardWithUtility = (fileUrl: string): boolean => {
  const payload = `copy\n${fileUrl}\n`;

  if (process.env.WAYLAND_DISPLAY && commandExists('wl-copy')) {
    try {
      return (
        spawnSync('wl-copy', ['--type', 'x-special/gnome-copied-files'], {
          input: payload,
          stdio: ['pipe', 'ignore', 'ignore'],
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  if (commandExists('xclip')) {
    try {
      return (
        spawnSync(
          'xclip',
          ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files', '-i'],
          {
            input: payload,
            stdio: ['pipe', 'ignore', 'ignore'],
          },
        ).status === 0
      );
    } catch {
      return false;
    }
  }

  return false;
};

const buildWebviewContextMenu = (
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): Menu => {
  const history = contents.navigationHistory;
  const hasSelection = params.selectionText.trim().length > 0;
  const hasLink = params.linkURL.trim().length > 0;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Back',
      enabled: history.canGoBack(),
      click: () => {
        if (!contents.isDestroyed() && contents.navigationHistory.canGoBack()) {
          contents.navigationHistory.goBack();
        }
      },
    },
    {
      label: 'Forward',
      enabled: history.canGoForward(),
      click: () => {
        if (!contents.isDestroyed() && contents.navigationHistory.canGoForward()) {
          contents.navigationHistory.goForward();
        }
      },
    },
    {
      label: 'Reload',
      click: () => {
        if (!contents.isDestroyed()) {
          contents.reload();
        }
      },
    },
  ];

  if (hasLink || hasSelection || params.isEditable) {
    template.push({ type: 'separator' });
  }

  if (hasLink) {
    template.push(
      {
        label: 'Open Link in Browser',
        click: () => {
          void shell.openExternal(params.linkURL);
        },
      },
      {
        label: 'Copy Link Address',
        click: () => {
          clipboard.writeText(params.linkURL);
        },
      },
    );
  }

  if (params.isEditable) {
    template.push(
      {
        label: 'Cut',
        enabled: params.editFlags.canCut,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.cut();
          }
        },
      },
      {
        label: 'Copy',
        enabled: params.editFlags.canCopy,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.copy();
          }
        },
      },
      {
        label: 'Paste',
        enabled: params.editFlags.canPaste,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.paste();
          }
        },
      },
      {
        label: 'Select All',
        enabled: params.editFlags.canSelectAll,
        click: () => {
          if (!contents.isDestroyed()) {
            contents.selectAll();
          }
        },
      },
    );
  } else if (hasSelection) {
    template.push({
      label: 'Copy',
      enabled: params.editFlags.canCopy,
      click: () => {
        if (!contents.isDestroyed()) {
          contents.copy();
        }
      },
    });
  }

  return Menu.buildFromTemplate(template);
};

const installWebviewContextMenu = (contents: Electron.WebContents): void => {
  contents.on('context-menu', (event, params) => {
    event.preventDefault();
    const ownerWindow = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents);
    buildWebviewContextMenu(contents, params).popup({
      window: ownerWindow ?? undefined,
    });
  });
};

const sanitizeDownloadFileName = (value: string | undefined, fallback = 'telegram-document'): string => {
  const base = path
    .basename(value?.trim() || fallback)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replaceAll(/[\n\r\t]/g, '_');
  const cleaned = [...base].map((char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  return cleaned || fallback;
};

const resolveUniqueDownloadPath = (downloadsDir: string, fileName: string): string => {
  const parsed = path.parse(fileName);
  const stem = parsed.name || 'telegram-document';
  const ext = parsed.ext || '';
  let attempt = path.join(downloadsDir, `${stem}${ext}`);
  let index = 1;

  while (fs.existsSync(attempt)) {
    attempt = path.join(downloadsDir, `${stem} (${index})${ext}`);
    index += 1;
  }

  return attempt;
};

const saveResolvedDocumentToDownloads = async (
  document: ResolvedDocument,
  onProgress?: (progress: number) => void,
): Promise<string | undefined> => {
  const sourcePath = document.filePath.trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return undefined;
  }

  const downloadsDir = app.getPath('downloads');
  await mkdir(downloadsDir, { recursive: true });
  const preferredName =
    document.fileName && document.fileName !== 'Document'
      ? document.fileName
      : path.basename(sourcePath);

  const targetPath = resolveUniqueDownloadPath(
    downloadsDir,
    sanitizeDownloadFileName(preferredName, path.basename(sourcePath)),
  );

  if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
    const totalBytes = Math.max(document.sizeBytes ?? fs.statSync(sourcePath).size, 0);
    await new Promise<void>((resolve, reject) => {
      let copiedBytes = 0;
      let lastReportedProgress = -1;
      let lastReportAt = 0;
      const reader = createReadStream(sourcePath);
      const writer = createWriteStream(targetPath, { flags: 'wx' });

      reader.on('data', (chunk: Buffer | string) => {
        copiedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
        if (totalBytes > 0) {
          const progress = Math.min(copiedBytes / totalBytes, 1);
          const now = Date.now();
          if (
            progress === 1 ||
            progress - lastReportedProgress >= 0.02 ||
            now - lastReportAt >= 90
          ) {
            lastReportedProgress = progress;
            lastReportAt = now;
            onProgress?.(progress);
          }
        }
      });

      const fail = (error: unknown) => {
        reader.destroy();
        writer.destroy();
        void rm(targetPath, { force: true }).catch(() => {
          // Best-effort cleanup for partial files.
        });
        reject(error);
      };

      reader.on('error', fail);
      writer.on('error', fail);

      reader.pipe(writer);
      void finished(writer)
        .then(() => {
          onProgress?.(1);
          resolve();
        })
        .catch(fail);
    });
  } else {
    onProgress?.(1);
  }

  if (!fs.existsSync(targetPath)) {
    return undefined;
  }

  try {
    app.addRecentDocument(targetPath);
  } catch {
    // Best-effort OS integration only.
  }

  return targetPath;
};

const copyResolvedDocumentToClipboard = async (
  document: ResolvedDocument,
): Promise<boolean> => {
  const sourcePath = document.filePath.trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  const fileUrl = pathToFileURL(sourcePath).toString();

  try {
    clipboard.clear();
    clipboard.write({ text: sourcePath });
    clipboard.writeBuffer('text/plain', Buffer.from(sourcePath, 'utf8'));
    clipboard.writeBuffer('text/plain;charset=utf-8', Buffer.from(sourcePath, 'utf8'));
    clipboard.writeBuffer('text/uri-list', Buffer.from(`${fileUrl}\n`, 'utf8'));

    if (process.platform === 'linux') {
      const linuxCopyPayload = Buffer.from(`copy\n${fileUrl}\n`, 'utf8');
      clipboard.writeBuffer(
        'x-special/gnome-copied-files',
        linuxCopyPayload,
      );
      clipboard.writeBuffer('x-special/nautilus-clipboard', linuxCopyPayload);
    }

    if (process.platform === 'darwin' || process.platform === 'win32') {
      clipboard.writeBookmark(path.basename(sourcePath), fileUrl);
    }

    if (process.platform !== 'linux') {
      return true;
    }

    const formats = clipboard.availableFormats();
    if (
      formats.includes('x-special/gnome-copied-files') ||
      formats.includes('x-special/nautilus-clipboard')
    ) {
      return true;
    }

    return writeLinuxClipboardWithUtility(fileUrl);
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
  wireNetworkShortcutHandling(mainWindow.webContents);

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      wireNetworkShortcutHandling(contents);
      installWebviewContextMenu(contents);
    }
  });

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
      wireNetworkShortcutHandling(mainWindow.webContents);
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
  'connector:download-document',
  async (_event, network: NetworkId, chatId: string, messageId: string) => {
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
    if (!connectorManager) {
      return false;
    }
    return connectorManager.forwardMessage(network, fromChatId, toChatId, messageId);
  },
);

ipcMain.handle(
  'connector:copy-document',
  async (_event, network: NetworkId, chatId: string, messageId: string) => {
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
