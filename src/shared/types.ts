export type AppMode = 'normal' | 'insert';

export type NetworkId = 'telegram' | 'instagram';

export interface NetworkDefinition {
  id: NetworkId;
  name: string;
  partition: string;
  homeUrl: string;
  loginHint: string;
  supportLevel: 'native-web' | 'official-api-fallback';
}

export interface TelegramUserConfig {
  ghostMode: boolean;
}

export interface AppearanceUserConfig {
  windowPadding: number;
  windowBorderRadius: number;
  fontFamily: string;
  fontSize: number;
  backgroundOpacity: number;
  textOpacity: number;
}

export interface UserConfig {
  telegram: TelegramUserConfig;
  appearance: AppearanceUserConfig;
}

export interface AppConfig {
  version: string;
  networks: NetworkDefinition[];
  shortcuts: {
    forceNormalMode: string;
  };
  userConfig: UserConfig;
  configPath: string;
}

export type AppActivityState = 'running' | 'success' | 'error';

export interface AppActivity {
  id: string;
  label: string;
  detail?: string;
  progress?: number;
  indeterminate?: boolean;
  state: AppActivityState;
}
