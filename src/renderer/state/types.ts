import type {
  AppActivity,
  AppConfig,
  AppMode,
  AppPane,
  RuntimeDiagnostics,
  UserConfig,
} from '../../shared/types';
import type { LegacyAppSnapshot, LegacyCommandItem } from '../legacyBridge';

export interface AppShellState {
  legacyReady: boolean;
  activeNetwork: LegacyAppSnapshot['activeNetwork'];
  activePane: AppPane;
  mode: AppMode;
}

export interface KeyboardState {
  showHints: boolean;
  captureInWebview: boolean;
  enableCounts: boolean;
}

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
}

export interface ModalState {
  keyboardHelpOpen: boolean;
}

export interface ActivityState {
  current: AppActivity | null;
}

export interface ConfigState {
  appConfig: AppConfig | null;
  userConfig: UserConfig | null;
  runtimeDiagnostics: RuntimeDiagnostics | null;
}

export interface LegacyState {
  snapshot: LegacyAppSnapshot | null;
  commands: LegacyCommandItem[];
}

export interface AppState {
  activity: ActivityState;
  appShell: AppShellState;
  commandPalette: CommandPaletteState;
  config: ConfigState;
  keyboard: KeyboardState;
  legacy: LegacyState;
  modals: ModalState;
}

export type AppAction =
  | { type: 'config/loaded'; appConfig: AppConfig; runtimeDiagnostics: RuntimeDiagnostics | null }
  | { type: 'config/toggleSendBehavior' }
  | { type: 'legacy/ready' }
  | { type: 'legacy/snapshot'; snapshot: LegacyAppSnapshot }
  | { type: 'legacy/commands'; commands: LegacyCommandItem[] }
  | { type: 'activity/set'; activity: AppActivity | null }
  | { type: 'commandPalette/open' }
  | { type: 'commandPalette/close' }
  | { type: 'commandPalette/query'; query: string }
  | { type: 'commandPalette/select'; index: number }
  | { type: 'keyboardHelp/open' }
  | { type: 'keyboardHelp/close' }
  | {
      type: 'keyboard/config';
      showHints: boolean;
      captureInWebview: boolean;
      enableCounts: boolean;
    };
