import type { AppConfig, RuntimeDiagnostics } from '../../shared/types';
import type { LegacyAppSnapshot, LegacyCommandItem } from '../legacyBridge';
import type { AppAction } from './types';

export const configLoaded = (
  appConfig: AppConfig,
  runtimeDiagnostics: RuntimeDiagnostics | null,
): AppAction => ({
  type: 'config/loaded',
  appConfig,
  runtimeDiagnostics,
});

export const legacyReady = (): AppAction => ({ type: 'legacy/ready' });

export const legacySnapshotChanged = (snapshot: LegacyAppSnapshot): AppAction => ({
  type: 'legacy/snapshot',
  snapshot,
});

export const legacyCommandsChanged = (commands: LegacyCommandItem[]): AppAction => ({
  type: 'legacy/commands',
  commands,
});
