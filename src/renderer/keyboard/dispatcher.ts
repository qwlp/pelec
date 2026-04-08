import type { AppMode, KeyboardActionId, ShortcutConfig } from '../../shared/types';
import type { LegacyAppBridgeApi } from '../legacyBridge';
import { performKeyboardAction } from './actions';
import { resolveActionBinding } from './keymap';
import { matchesBinding, normalizeKeyboardEvent } from './normalizer';
import { resolveKeyboardScope } from './scopes';

export interface KeyboardDispatcherState {
  pendingSequence: string | null;
  pendingSequenceAt: number;
}

export interface KeyboardDispatcherContext {
  activePane: Parameters<typeof resolveKeyboardScope>[1];
  captureInWebview: boolean;
  closeCommandPalette(): void;
  closeKeyboardHelp(): void;
  commandPaletteOpen: boolean;
  customKeymap: Partial<Record<KeyboardActionId, string>>;
  keyboardHelpOpen: boolean;
  legacyApi: LegacyAppBridgeApi | null;
  mode: AppMode;
  onFocusSearch?(): void;
  onMoveLeft?(): void;
  onMoveRight?(): void;
  openCommandPalette(): void;
  openKeyboardHelp(): void;
  setMode(mode: AppMode): void;
  shortcuts: ShortcutConfig;
}

const SEQUENCE_TIMEOUT_MS = 420;

export const dispatchKeyboardEvent = (
  event: KeyboardEvent,
  context: KeyboardDispatcherContext,
  state: KeyboardDispatcherState,
): boolean => {
  if (event.isComposing) {
    return false;
  }

  const normalized = normalizeKeyboardEvent(event);
  const scope = resolveKeyboardScope(
    event.target,
    context.activePane,
    context.commandPaletteOpen,
    context.keyboardHelpOpen,
  );
  const now = Date.now();

  const runAction = (actionId: KeyboardActionId): boolean => {
    const handled = performKeyboardAction(actionId, {
      closeCommandPalette: context.closeCommandPalette,
      closeKeyboardHelp: context.closeKeyboardHelp,
      legacyApi: context.legacyApi,
      onFocusSearch: context.onFocusSearch,
      onMoveLeft: context.onMoveLeft,
      onMoveRight: context.onMoveRight,
      openCommandPalette: context.openCommandPalette,
      openKeyboardHelp: context.openKeyboardHelp,
      setMode: context.setMode,
    });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      state.pendingSequence = null;
      state.pendingSequenceAt = 0;
    }
    return handled;
  };

  if (
    matchesBinding(normalized, context.shortcuts.forceNormalMode) &&
    context.legacyApi
  ) {
    event.preventDefault();
    event.stopPropagation();
    context.legacyApi.handleEscape();
    context.closeCommandPalette();
    return true;
  }

  if (context.keyboardHelpOpen) {
    if (normalized.key === 'Escape' || matchesBinding(normalized, context.shortcuts.openKeyboardHelp)) {
      event.preventDefault();
      event.stopPropagation();
      context.closeKeyboardHelp();
      context.setMode(context.legacyApi?.getSnapshot().mode ?? 'normal');
      return true;
    }
    return false;
  }

  if (
    !normalized.isTypingTarget &&
    runAction('openCommandPalette') &&
    matchesBinding(normalized, context.shortcuts.openCommandPalette)
  ) {
    return true;
  }
  if (
    !normalized.isTypingTarget &&
    runAction('switchTelegram') &&
    matchesBinding(normalized, context.shortcuts.telegramNetwork)
  ) {
    return true;
  }

  if (scope === 'commandPalette') {
    if (normalized.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      context.closeCommandPalette();
      return true;
    }
    return false;
  }

  if (normalized.isTypingTarget && scope !== 'webview') {
    return false;
  }

  if (runAction('openKeyboardHelp') && matchesBinding(normalized, context.shortcuts.openKeyboardHelp)) {
    return true;
  }

  if (scope === 'webview' && !context.captureInWebview) {
    return false;
  }

  if (normalized.key === 'Escape' && context.legacyApi) {
    event.preventDefault();
    event.stopPropagation();
    context.legacyApi.handleEscape();
    context.closeCommandPalette();
    return true;
  }

  if (normalized.key === ':') {
    return runAction('openCommandPalette');
  }

  if (context.mode !== 'normal') {
    return false;
  }

  if (normalized.key === 'g') {
    if (state.pendingSequence === 'g' && now - state.pendingSequenceAt <= SEQUENCE_TIMEOUT_MS) {
      return runAction('moveToTop');
    }
    state.pendingSequence = 'g';
    state.pendingSequenceAt = now;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  if (now - state.pendingSequenceAt > SEQUENCE_TIMEOUT_MS) {
    state.pendingSequence = null;
    state.pendingSequenceAt = 0;
  }

  if (normalized.key === 'G') {
    return runAction('moveToBottom');
  }
  if (normalized.key === ' ') {
    return runAction(event.shiftKey ? 'movePageUp' : 'movePageDown');
  }

  const actionOrder: KeyboardActionId[] = [
    'focusSearch',
    'nextPane',
    'previousPane',
    'moveDown',
    'moveUp',
    'moveLeft',
    'moveRight',
    'movePageUp',
    'movePageDown',
    'activateSelection',
    'toggleInsertMode',
    'refresh',
    'reply',
    'deleteMessage',
    'startAuth',
    'openBrowser',
  ];

  for (const actionId of actionOrder) {
    if (matchesBinding(normalized, resolveActionBinding(actionId, context.customKeymap, context.shortcuts))) {
      return runAction(actionId);
    }
  }

  return false;
};
