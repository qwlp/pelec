import type { KeyboardActionId, ShortcutConfig } from '../../shared/types';

export const DEFAULT_KEYBOARD_ACTION_KEYMAP: Record<KeyboardActionId, string> = {
  activateSelection: 'Enter',
  deleteMessage: 'd',
  focusSearch: '/',
  moveDown: 'j',
  moveLeft: 'h',
  movePageDown: 'Ctrl+d',
  movePageUp: 'Ctrl+u',
  moveRight: 'l',
  moveToBottom: 'G',
  moveToTop: 'gg',
  moveUp: 'k',
  nextPane: 'Tab',
  openBrowser: 'o',
  openCommandPalette: 'CommandOrControl+K',
  openKeyboardHelp: 'Shift+/',
  previousPane: 'Shift+Tab',
  refresh: 'r',
  reply: 'r',
  startAuth: 'a',
  switchInstagram: 'Alt+2',
  switchTelegram: 'Alt+1',
  toggleInsertMode: 'i',
};

export const resolveActionBinding = (
  actionId: KeyboardActionId,
  customKeymap: Partial<Record<KeyboardActionId, string>>,
  shortcuts: ShortcutConfig,
): string => {
  if (actionId === 'openCommandPalette') {
    return shortcuts.openCommandPalette;
  }
  if (actionId === 'openKeyboardHelp') {
    return shortcuts.openKeyboardHelp;
  }
  if (actionId === 'focusSearch') {
    return shortcuts.focusSearch;
  }
  if (actionId === 'nextPane') {
    return shortcuts.nextPane;
  }
  if (actionId === 'previousPane') {
    return shortcuts.previousPane;
  }
  if (actionId === 'switchTelegram') {
    return shortcuts.telegramNetwork;
  }
  if (actionId === 'switchInstagram') {
    return shortcuts.instagramNetwork;
  }

  return customKeymap[actionId] ?? DEFAULT_KEYBOARD_ACTION_KEYMAP[actionId];
};
