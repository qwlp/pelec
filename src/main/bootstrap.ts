import { app, BrowserWindow, globalShortcut } from 'electron';
import type { ConnectorUpdateEvent } from '../shared/connectors';
import type { AppConfig } from '../shared/types';
import { emitAppActivity } from './activity';
import { buildAppConfig } from './config';
import { ConnectorManager } from './connectors/connectorManager';
import { registerIpcHandlers } from './ipc';
import { registerMediaProtocol } from './mediaProtocol';
import { wireNetworkShortcutHandling } from './shortcuts';
import { loadUserConfig } from './userConfig';
import { installWebviewContextMenu } from './webviewContextMenu';
import { createMainWindow } from './window';

export const bootstrapApp = (): void => {
  let connectorManager: ConnectorManager | null = null;
  let mainWindow: BrowserWindow | null = null;
  let appShutdownStarted = false;
  let appConfig: AppConfig | null = null;

  const activateNetwork = (network: AppConfig['networks'][number]['id']): void => {
    mainWindow?.webContents.send('app:activate-network', network);
  };

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

  registerIpcHandlers({
    getAppConfig: () => appConfig,
    getConnectorManager: () => connectorManager,
    getMainWindow: () => mainWindow,
    emitAppActivity,
  });

  app.whenReady().then(() => {
    void (async () => {
      registerMediaProtocol();

      const loadedUserConfig = await loadUserConfig(app.getPath('userData'));
      if (loadedUserConfig.warnings.length > 0) {
        for (const warning of loadedUserConfig.warnings) {
          console.warn(`[config] ${warning}`);
        }
      }

      appConfig = buildAppConfig(loadedUserConfig.configPath, loadedUserConfig.userConfig);
      connectorManager = new ConnectorManager(appConfig, app.getPath('userData'));
      connectorManager.onConnectorUpdate((event: ConnectorUpdateEvent) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('connector:update', event);
        }
      });
      void connectorManager.initAll();

      mainWindow = createMainWindow();
      wireNetworkShortcutHandling(mainWindow.webContents, activateNetwork);

      app.on('web-contents-created', (_event, contents) => {
        if (contents.getType() !== 'webview') {
          return;
        }

        wireNetworkShortcutHandling(contents, activateNetwork);
        installWebviewContextMenu(contents);
      });

      const shortcut = appConfig.shortcuts.forceNormalMode;
      const registered = globalShortcut.register(shortcut, () => {
        mainWindow?.webContents.send('app:force-normal-mode');
      });

      if (!registered) {
        console.warn(`Failed to register shortcut: ${shortcut}`);
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length > 0) {
          return;
        }

        mainWindow = createMainWindow();
        wireNetworkShortcutHandling(mainWindow.webContents, activateNetwork);
      });
    })().catch((error) => {
      console.error('Application startup failed.', error);
      app.exit(1);
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
};
