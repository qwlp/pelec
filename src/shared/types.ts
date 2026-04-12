export type AppMode = 'normal' | 'insert' | 'command';

export type AppPane =
  | 'networks'
  | 'telegram-chats'
  | 'telegram-messages'
  | 'telegram-composer'
  | 'instagram-chats'
  | 'instagram-messages'
  | 'instagram-composer'
  | 'command-palette'
  | 'modal'
  | 'webview';

export type NetworkId = 'telegram' | 'instagram';

export type SendBehavior = 'enter' | 'mod-enter';

export type KeyboardActionId =
  | 'activateSelection'
  | 'deleteMessage'
  | 'focusSearch'
  | 'moveDown'
  | 'moveLeft'
  | 'movePageDown'
  | 'movePageUp'
  | 'moveRight'
  | 'moveToBottom'
  | 'moveToTop'
  | 'moveUp'
  | 'nextPane'
  | 'openBrowser'
  | 'openCommandPalette'
  | 'openKeyboardHelp'
  | 'previousPane'
  | 'refresh'
  | 'reply'
  | 'startAuth'
  | 'switchInstagram'
  | 'switchTelegram'
  | 'toggleInsertMode';

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

export interface KeyboardUserConfig {
  showHints: boolean;
  sendBehavior: SendBehavior;
  captureInWebview: boolean;
  enableCounts: boolean;
  keymap: Partial<Record<KeyboardActionId, string>>;
}

export interface ShortcutConfig {
  forceNormalMode: string;
  openCommandPalette: string;
  openKeyboardHelp: string;
  focusSearch: string;
  nextPane: string;
  previousPane: string;
  telegramNetwork: string;
  instagramNetwork: string;
}

export interface UserConfig {
  telegram: TelegramUserConfig;
  appearance: AppearanceUserConfig;
  keyboard: KeyboardUserConfig;
  shortcuts: ShortcutConfig;
}

export interface AppConfig {
  version: string;
  networks: NetworkDefinition[];
  shortcuts: ShortcutConfig;
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

export interface RuntimeDiagnostics {
  appVersion: string;
  chromeVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  pid: number;
  memoryUsage: NodeJS.MemoryUsage;
}
