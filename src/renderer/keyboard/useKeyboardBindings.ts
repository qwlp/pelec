import { useEffect, useRef } from 'react';
import type { AppMode, KeyboardActionId, ShortcutConfig } from '../../shared/types';
import type { LegacyAppBridgeApi } from '../legacyBridge';
import { dispatchKeyboardEvent, type KeyboardDispatcherState } from './dispatcher';

interface UseKeyboardBindingsOptions {
  activePane: Parameters<typeof dispatchKeyboardEvent>[1]['activePane'];
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

export const useKeyboardBindings = (options: UseKeyboardBindingsOptions): void => {
  const optionsRef = useRef(options);
  const dispatcherStateRef = useRef<KeyboardDispatcherState>({
    pendingSequence: null,
    pendingSequenceAt: 0,
  });

  optionsRef.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      void dispatchKeyboardEvent(event, optionsRef.current, dispatcherStateRef.current);
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
};
