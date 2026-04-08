import type { WebContents } from 'electron';
import type { NetworkId, ShortcutConfig } from '../shared/types';

export type AppShortcutTarget =
  | NetworkId
  | 'open-command-palette'
  | 'open-keyboard-help';

const matchesAccelerator = (input: Electron.Input, accelerator: string): boolean => {
  if (input.type !== 'keyDown') {
    return false;
  }

  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  const code = 'code' in input && typeof input.code === 'string' ? input.code : '';
  const commandOrControl = parts.includes('CommandOrControl');
  const requiresAlt = parts.includes('Alt');
  const requiresCtrl = parts.includes('Ctrl');
  const requiresMeta = parts.includes('Meta');
  const requiresShift = parts.includes('Shift');

  const expectedCode =
    /^[a-z]$/i.test(key)
      ? `Key${key.toUpperCase()}`
      : /^[0-9]$/.test(key)
        ? `Digit${key}`
        : key === '/'
          ? 'Slash'
          : key === '['
            ? 'BracketLeft'
            : '';

  return (
    ((expectedCode && code ? code.toLowerCase() === expectedCode.toLowerCase() : false) ||
      input.key.toLowerCase() === key.toLowerCase()) &&
    Boolean(input.alt) === requiresAlt &&
    (commandOrControl
      ? Boolean(input.control) !== Boolean(input.meta)
      : Boolean(input.control) === requiresCtrl && Boolean(input.meta) === requiresMeta) &&
    Boolean(input.shift) === requiresShift
  );
};

export const resolveAppShortcutTarget = (
  input: Electron.Input,
  shortcuts: Pick<ShortcutConfig, 'openCommandPalette' | 'openKeyboardHelp' | 'telegramNetwork'>,
): AppShortcutTarget | null => {
  if (matchesAccelerator(input, shortcuts.telegramNetwork)) {
    return 'telegram';
  }

  if (matchesAccelerator(input, shortcuts.openCommandPalette)) {
    return 'open-command-palette';
  }

  if (matchesAccelerator(input, shortcuts.openKeyboardHelp)) {
    return 'open-keyboard-help';
  }

  return null;
};

export const wireAppShortcutHandling = (
  contents: WebContents,
  shortcuts: Pick<ShortcutConfig, 'openCommandPalette' | 'openKeyboardHelp' | 'telegramNetwork'>,
  handlers: {
    onActivateNetwork?: (network: NetworkId) => void;
    onOpenCommandPalette: () => void;
    onOpenKeyboardHelp: () => void;
  } & {
    allowNetworkTargets?: NetworkId[];
  },
): void => {
  contents.on('before-input-event', (event, input) => {
    const target = resolveAppShortcutTarget(input, shortcuts);
    if (!target) {
      return;
    }

    if (target === 'open-command-palette') {
      event.preventDefault();
      handlers.onOpenCommandPalette();
      return;
    }
    if (target === 'open-keyboard-help') {
      event.preventDefault();
      handlers.onOpenKeyboardHelp();
      return;
    }
    if (!handlers.onActivateNetwork) {
      return;
    }
    if (handlers.allowNetworkTargets && !handlers.allowNetworkTargets.includes(target)) {
      return;
    }
    event.preventDefault();
    handlers.onActivateNetwork(target);
  });
};
