import type { AppMode, KeyboardActionId } from '../../shared/types';
import type { LegacyAppBridgeApi } from '../legacyBridge';

export interface KeyboardActionContext {
  closeCommandPalette(): void;
  closeKeyboardHelp?(): void;
  legacyApi: LegacyAppBridgeApi | null;
  onFocusSearch?(): void;
  onMoveLeft?(): void;
  onMoveRight?(): void;
  openCommandPalette(): void;
  openKeyboardHelp(): void;
  setMode(mode: AppMode): void;
}

export const performKeyboardAction = (
  actionId: KeyboardActionId,
  context: KeyboardActionContext,
): boolean => {
  if (actionId === 'openCommandPalette') {
    context.openCommandPalette();
    return true;
  }

  if (actionId === 'openKeyboardHelp') {
    return false;
  }

  const api = context.legacyApi;
  if (!api) {
    return false;
  }

  switch (actionId) {
    case 'activateSelection':
      api.activateSelection();
      return true;
    case 'deleteMessage':
      api.deleteSelection();
      return true;
    case 'focusSearch':
      if (context.onFocusSearch) {
        context.onFocusSearch();
      } else {
        api.focusSearch();
      }
      return true;
    case 'moveDown':
      api.moveSelection(1);
      return true;
    case 'moveLeft':
      if (context.onMoveLeft) {
        context.onMoveLeft();
      } else {
        api.movePane(-1);
      }
      return true;
    case 'movePageDown':
      api.moveSelectionByPage(1);
      return true;
    case 'movePageUp':
      api.moveSelectionByPage(-1);
      return true;
    case 'moveRight':
      if (context.onMoveRight) {
        context.onMoveRight();
      } else {
        api.movePane(1);
      }
      return true;
    case 'moveToBottom':
      api.moveSelectionToEdge('last');
      return true;
    case 'moveToTop':
      api.moveSelectionToEdge('first');
      return true;
    case 'moveUp':
      api.moveSelection(-1);
      return true;
    case 'nextPane':
      api.movePane(1);
      return true;
    case 'openBrowser':
      api.openBrowser();
      return true;
    case 'previousPane':
      api.movePane(-1);
      return true;
    case 'refresh':
      api.refresh();
      return true;
    case 'reply':
      api.reply();
      return true;
    case 'startAuth':
      api.startAuth();
      return true;
    case 'switchTelegram':
      api.activateNetwork('telegram');
      context.closeCommandPalette();
      return true;
    case 'toggleInsertMode':
      context.setMode('insert');
      api.setMode('insert');
      return true;
    default:
      return false;
  }
};
