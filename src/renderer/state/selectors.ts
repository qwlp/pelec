import type { KeyboardActionId } from '../../shared/types';
import type { LegacyCommandItem } from '../legacyBridge';
import type { AppState } from './types';

type ShellCommandItem = {
  id: KeyboardActionId | 'toggle-send-behavior';
  label: string;
  group: LegacyCommandItem['group'];
};

export const selectDisplayMode = (state: AppState) =>
  state.commandPalette.isOpen ? 'command' : state.appShell.mode;

export const selectLegacyTelegramSnapshot = (state: AppState) => state.legacy.snapshot?.telegram ?? null;

export const selectAvailableCommandItems = (
  state: AppState,
): Array<LegacyCommandItem | ShellCommandItem> => [
  {
    id: 'focusSearch',
    label: 'focus active pane',
    group: 'actions',
  },
  {
    id: 'toggle-send-behavior',
    label:
      state.config.userConfig?.keyboard.sendBehavior === 'mod-enter'
        ? 'toggle send mode to Enter'
        : 'toggle send mode to Mod+Enter',
    group: 'mode',
  },
  ...state.legacy.commands,
];

export const selectCommandPaletteItems = (state: AppState) => {
  const query = state.commandPalette.query.trim().toLowerCase();
  const items = selectAvailableCommandItems(state);
  if (!query) {
    return items;
  }

  return [...items]
    .map((item) => {
      const label = item.label.toLowerCase();
      const startsWith = label.startsWith(query) ? 0 : 1;
      const includes = label.includes(query) ? 0 : 1;
      return {
        item,
        score: startsWith * 10 + includes * 5 + Math.abs(label.length - query.length),
      };
    })
    .filter((entry) => entry.item.label.toLowerCase().includes(query))
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
    .map((entry) => entry.item);
};
