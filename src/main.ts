import { app, protocol } from 'electron';
import started from 'electron-squirrel-startup';
import { bootstrapApp } from './main/bootstrap';
import {
  ensureDefaultTelegramCredentials,
  loadEnv,
  PELEC_MEDIA_SCHEME,
} from './main/config';

if (started) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: PELEC_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

loadEnv();
ensureDefaultTelegramCredentials();
bootstrapApp();
