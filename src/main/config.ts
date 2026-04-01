import { app } from 'electron';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, NetworkDefinition } from '../shared/types';

export const PELEC_MEDIA_SCHEME = 'pelec-media';

export const networks: NetworkDefinition[] = [
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
];

export const loadEnv = (): void => {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    dotenv.config({ path: envPath, override: false });
    break;
  }
};

export const ensureDefaultTelegramCredentials = (): void => {
  if (!process.env.TELEGRAM_API_ID) {
    process.env.TELEGRAM_API_ID = '35106525';
  }

  if (!process.env.TELEGRAM_API_HASH) {
    process.env.TELEGRAM_API_HASH = '90e7c85f263db08ae995ea0de68b4523';
  }
};

export const buildAppConfig = (
  configPath: string,
  userConfig: AppConfig['userConfig'],
): AppConfig => ({
  version: app.getVersion(),
  networks,
  shortcuts: {
    forceNormalMode: 'CommandOrControl+[',
  },
  userConfig,
  configPath,
});
