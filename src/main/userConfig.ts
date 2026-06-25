import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type {
  KeyboardActionId,
  SendBehavior,
  ShortcutConfig,
  UserConfig,
} from '../shared/types';

type RawUserConfig = {
  telegram?: {
    ghostMode?: unknown;
    selectableMessageText?: unknown;
    privateVoiceCalls?: unknown;
    privateVideoCalls?: unknown;
    groupCalls?: unknown;
  };
  appearance?: {
    windowPadding?: unknown;
    windowBorderRadius?: unknown;
    fontFamily?: unknown;
    fontSize?: unknown;
    backgroundOpacity?: unknown;
    textOpacity?: unknown;
  };
  keyboard?: {
    showHints?: unknown;
    sendBehavior?: unknown;
    captureInWebview?: unknown;
    enableVimMode?: unknown;
    enableCounts?: unknown;
  };
  shortcuts?: Partial<Record<keyof ShortcutConfig, unknown>>;
  keymap?: Partial<Record<KeyboardActionId, unknown>>;
};

type ParsedUserConfig = {
  rawConfig: RawUserConfig;
  warnings: string[];
};

export interface LoadedUserConfig {
  configPath: string;
  userConfig: UserConfig;
  warnings: string[];
}

const TOML_KEY_TO_SHORTCUT_KEY: Record<string, keyof ShortcutConfig> = {
  force_normal_mode: 'forceNormalMode',
  open_command_palette: 'openCommandPalette',
  open_keyboard_help: 'openKeyboardHelp',
  focus_search: 'focusSearch',
  next_pane: 'nextPane',
  previous_pane: 'previousPane',
  telegram_network: 'telegramNetwork',
};

const TOML_KEY_TO_KEYMAP_ACTION: Record<string, KeyboardActionId> = {
  activate_selection: 'activateSelection',
  delete_message: 'deleteMessage',
  focus_search: 'focusSearch',
  move_down: 'moveDown',
  move_left: 'moveLeft',
  move_page_down: 'movePageDown',
  move_page_up: 'movePageUp',
  move_right: 'moveRight',
  move_to_bottom: 'moveToBottom',
  move_to_top: 'moveToTop',
  move_up: 'moveUp',
  next_pane: 'nextPane',
  open_browser: 'openBrowser',
  open_command_palette: 'openCommandPalette',
  open_keyboard_help: 'openKeyboardHelp',
  previous_pane: 'previousPane',
  refresh: 'refresh',
  reply: 'reply',
  start_auth: 'startAuth',
  switch_telegram: 'switchTelegram',
  toggle_insert_mode: 'toggleInsertMode',
};

export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  forceNormalMode: 'CommandOrControl+[',
  openCommandPalette: 'CommandOrControl+K',
  openKeyboardHelp: 'Shift+/',
  focusSearch: '/',
  nextPane: 'Tab',
  previousPane: 'Shift+Tab',
  telegramNetwork: 'Alt+1',
};

export const DEFAULT_USER_CONFIG: UserConfig = {
  telegram: {
    ghostMode: false,
    selectableMessageText: false,
    calls: {
      privateVoice: false,
      privateVideo: false,
      group: false,
    },
  },
  appearance: {
    windowPadding: 12,
    windowBorderRadius: 0,
    fontFamily:
      'Ioskeley Mono, Iosevka Mono, Iosevka, JetBrains Mono, IBM Plex Mono, Fira Code, Consolas, monospace',
    fontSize: 14,
    backgroundOpacity: 0.92,
    textOpacity: 1,
  },
  keyboard: {
    showHints: true,
    sendBehavior: 'enter',
    captureInWebview: false,
    enableVimMode: true,
    enableCounts: true,
    keymap: {
      reply: 'r',
      deleteMessage: 'd',
      refresh: 'r',
    },
  },
  shortcuts: DEFAULT_SHORTCUT_CONFIG,
};

const USER_CONFIG_FILE_NAME = 'config.toml';

const DEFAULT_USER_CONFIG_TOML = `# PELEC user config
# Restart the app after editing this file.

[telegram]
# When true, Telegram chats are fetched without opening the chat watcher.
ghost_mode = false

# When true, message text can be selected and copied with the mouse.
selectable_message_text = false

# Experimental Telegram calling features. The native call engine must be installed.
private_voice_calls = false
private_video_calls = false
group_calls = false

[appearance]
# Padding around the main app frame in pixels.
window_padding = 12

# Corner radius for the outer app frame in pixels.
window_border_radius = 0

# CSS font-family value used across the app.
font_family = "Ioskeley Mono, Iosevka Mono, Iosevka, JetBrains Mono, IBM Plex Mono, Fira Code, Consolas, monospace"

# Base font size for the app in pixels.
font_size = 14

# Background transparency for the app shell and panels.
# 0.0 = fully transparent, 1.0 = fully opaque
background_opacity = 0.92

# Text transparency across the app theme.
# 0.0 = fully transparent, 1.0 = fully opaque
text_opacity = 1.0

[keyboard]
show_hints = true
send_behavior = "enter"
capture_in_webview = false
enable_vim_mode = true
enable_counts = true

[shortcuts]
force_normal_mode = "CommandOrControl+["
open_command_palette = "CommandOrControl+K"
open_keyboard_help = "Shift+/"
focus_search = "/"
next_pane = "Tab"
previous_pane = "Shift+Tab"
telegram_network = "Alt+1"

[keymap]
reply = "r"
delete_message = "d"
refresh = "r"
`;

const quoteTomlString = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export const serializeUserConfig = (config: UserConfig): string => `# PELEC user config
# Managed by the in-app settings panel. Manual edits are also supported.

[telegram]
ghost_mode = ${String(config.telegram.ghostMode)}
selectable_message_text = ${String(config.telegram.selectableMessageText)}
private_voice_calls = ${String(config.telegram.calls.privateVoice)}
private_video_calls = ${String(config.telegram.calls.privateVideo)}
group_calls = ${String(config.telegram.calls.group)}

[appearance]
window_padding = ${config.appearance.windowPadding}
window_border_radius = ${config.appearance.windowBorderRadius}
font_family = ${quoteTomlString(config.appearance.fontFamily)}
font_size = ${config.appearance.fontSize}
background_opacity = ${config.appearance.backgroundOpacity}
text_opacity = ${config.appearance.textOpacity}

[keyboard]
show_hints = ${String(config.keyboard.showHints)}
send_behavior = ${quoteTomlString(config.keyboard.sendBehavior)}
capture_in_webview = ${String(config.keyboard.captureInWebview)}
enable_vim_mode = ${String(config.keyboard.enableVimMode)}
enable_counts = ${String(config.keyboard.enableCounts)}

[shortcuts]
force_normal_mode = ${quoteTomlString(config.shortcuts.forceNormalMode)}
open_command_palette = ${quoteTomlString(config.shortcuts.openCommandPalette)}
open_keyboard_help = ${quoteTomlString(config.shortcuts.openKeyboardHelp)}
focus_search = ${quoteTomlString(config.shortcuts.focusSearch)}
next_pane = ${quoteTomlString(config.shortcuts.nextPane)}
previous_pane = ${quoteTomlString(config.shortcuts.previousPane)}
telegram_network = ${quoteTomlString(config.shortcuts.telegramNetwork)}

[keymap]
${Object.entries(config.keyboard.keymap)
  .map(([key, value]) => {
    const tomlKey = Object.entries(TOML_KEY_TO_KEYMAP_ACTION).find(([, action]) => action === key)?.[0];
    return tomlKey && value ? `${tomlKey} = ${quoteTomlString(value)}` : '';
  })
  .filter(Boolean)
  .join('\n')}
`;

export const saveUserConfig = async (
  configPath: string,
  userConfig: UserConfig,
): Promise<void> => {
  await writeFile(configPath, serializeUserConfig(userConfig), 'utf8');
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const parseTomlScalar = (value: string): unknown => {
  const trimmed = value.trim();
  if (/^(?:true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }

  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const stripTomlComment = (line: string): string => {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      const escaped = index > 0 && line[index - 1] === '\\';
      if (!escaped) {
        inDoubleQuote = !inDoubleQuote;
      }
    } else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      break;
    }

    result += char;
  }

  return result;
};

const parseUserConfigToml = (source: string): ParsedUserConfig => {
  const rawConfig: RawUserConfig = {};
  const warnings: string[] = [];
  let section: 'telegram' | 'appearance' | 'keyboard' | 'shortcuts' | 'keymap' | null = null;

  for (const [lineIndex, originalLine] of source.split(/\r?\n/u).entries()) {
    const withoutComment = stripTomlComment(originalLine).trim();
    if (!withoutComment) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_-]+)\]$/u.exec(withoutComment);
    if (sectionMatch) {
      const nextSection = sectionMatch[1];
      if (
        nextSection === 'telegram' ||
        nextSection === 'appearance' ||
        nextSection === 'keyboard' ||
        nextSection === 'shortcuts' ||
        nextSection === 'keymap'
      ) {
        section = nextSection;
      } else {
        section = null;
        warnings.push(`Ignoring unsupported section [${nextSection}] on line ${lineIndex + 1}.`);
      }
      continue;
    }

    const entryMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(withoutComment);
    if (!entryMatch) {
      warnings.push(`Ignoring malformed config entry on line ${lineIndex + 1}.`);
      continue;
    }

    if (!section) {
      warnings.push(`Ignoring config entry outside a known section on line ${lineIndex + 1}.`);
      continue;
    }

    const key = entryMatch[1];
    const value = parseTomlScalar(entryMatch[2]);

    if (section === 'telegram') {
      rawConfig.telegram ??= {};
      if (key === 'ghost_mode') {
        rawConfig.telegram.ghostMode = value;
      } else if (key === 'selectable_message_text') {
        rawConfig.telegram.selectableMessageText = value;
      } else if (key === 'private_voice_calls') {
        rawConfig.telegram.privateVoiceCalls = value;
      } else if (key === 'private_video_calls') {
        rawConfig.telegram.privateVideoCalls = value;
      } else if (key === 'group_calls') {
        rawConfig.telegram.groupCalls = value;
      } else {
        warnings.push(`Ignoring unknown telegram key "${key}" on line ${lineIndex + 1}.`);
      }
      continue;
    }

    if (section === 'appearance') {
      rawConfig.appearance ??= {};
      if (key === 'window_padding') {
        rawConfig.appearance.windowPadding = value;
      } else if (key === 'window_border_radius') {
        rawConfig.appearance.windowBorderRadius = value;
      } else if (key === 'font_family') {
        rawConfig.appearance.fontFamily = value;
      } else if (key === 'font_size') {
        rawConfig.appearance.fontSize = value;
      } else if (key === 'background_opacity') {
        rawConfig.appearance.backgroundOpacity = value;
      } else if (key === 'text_opacity') {
        rawConfig.appearance.textOpacity = value;
      } else {
        warnings.push(`Ignoring unknown appearance key "${key}" on line ${lineIndex + 1}.`);
      }
      continue;
    }

    if (section === 'keyboard') {
      rawConfig.keyboard ??= {};
      if (key === 'show_hints') {
        rawConfig.keyboard.showHints = value;
      } else if (key === 'send_behavior') {
        rawConfig.keyboard.sendBehavior = value;
      } else if (key === 'capture_in_webview') {
        rawConfig.keyboard.captureInWebview = value;
      } else if (key === 'enable_vim_mode') {
        rawConfig.keyboard.enableVimMode = value;
      } else if (key === 'enable_counts') {
        rawConfig.keyboard.enableCounts = value;
      } else {
        warnings.push(`Ignoring unknown keyboard key "${key}" on line ${lineIndex + 1}.`);
      }
      continue;
    }

    if (section === 'shortcuts') {
      rawConfig.shortcuts ??= {};
      if (key === 'instagram_network') {
        continue;
      }
      const shortcutKey = TOML_KEY_TO_SHORTCUT_KEY[key];
      if (!shortcutKey) {
        warnings.push(`Ignoring unknown shortcuts key "${key}" on line ${lineIndex + 1}.`);
        continue;
      }
      rawConfig.shortcuts[shortcutKey] = value;
      continue;
    }

    rawConfig.keymap ??= {};
    if (key === 'switch_instagram') {
      continue;
    }
    const action = TOML_KEY_TO_KEYMAP_ACTION[key];
    if (!action) {
      warnings.push(`Ignoring unknown keymap key "${key}" on line ${lineIndex + 1}.`);
      continue;
    }
    rawConfig.keymap[action] = value;
  }

  return {
    rawConfig,
    warnings,
  };
};

const coerceBoolean = (
  value: unknown,
  fallback: boolean,
  keyPath: string,
  warnings: string[],
): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'undefined') {
    warnings.push(`Invalid boolean for ${keyPath}; using default ${String(fallback)}.`);
  }

  return fallback;
};

const coerceNumber = (
  value: unknown,
  fallback: number,
  keyPath: string,
  warnings: string[],
): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'undefined') {
    warnings.push(`Invalid number for ${keyPath}; using default ${String(fallback)}.`);
  }

  return fallback;
};

const coerceString = (
  value: unknown,
  fallback: string,
  keyPath: string,
  warnings: string[],
): string => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value !== 'undefined') {
    warnings.push(`Invalid string for ${keyPath}; using default.`);
  }

  return fallback;
};

const coerceSendBehavior = (
  value: unknown,
  fallback: SendBehavior,
  keyPath: string,
  warnings: string[],
): SendBehavior => {
  if (value === 'enter' || value === 'mod-enter') {
    return value;
  }

  if (typeof value !== 'undefined') {
    warnings.push(`Invalid send behavior for ${keyPath}; using default ${fallback}.`);
  }

  return fallback;
};

const resolveShortcutConfig = (
  rawConfig: RawUserConfig,
  warnings: string[],
): ShortcutConfig => ({
  forceNormalMode: coerceString(
    rawConfig.shortcuts?.forceNormalMode,
    DEFAULT_SHORTCUT_CONFIG.forceNormalMode,
    'shortcuts.force_normal_mode',
    warnings,
  ),
  openCommandPalette: coerceString(
    rawConfig.shortcuts?.openCommandPalette,
    DEFAULT_SHORTCUT_CONFIG.openCommandPalette,
    'shortcuts.open_command_palette',
    warnings,
  ),
  openKeyboardHelp: coerceString(
    rawConfig.shortcuts?.openKeyboardHelp,
    DEFAULT_SHORTCUT_CONFIG.openKeyboardHelp,
    'shortcuts.open_keyboard_help',
    warnings,
  ),
  focusSearch: coerceString(
    rawConfig.shortcuts?.focusSearch,
    DEFAULT_SHORTCUT_CONFIG.focusSearch,
    'shortcuts.focus_search',
    warnings,
  ),
  nextPane: coerceString(
    rawConfig.shortcuts?.nextPane,
    DEFAULT_SHORTCUT_CONFIG.nextPane,
    'shortcuts.next_pane',
    warnings,
  ),
  previousPane: coerceString(
    rawConfig.shortcuts?.previousPane,
    DEFAULT_SHORTCUT_CONFIG.previousPane,
    'shortcuts.previous_pane',
    warnings,
  ),
  telegramNetwork: coerceString(
    rawConfig.shortcuts?.telegramNetwork,
    DEFAULT_SHORTCUT_CONFIG.telegramNetwork,
    'shortcuts.telegram_network',
    warnings,
  ),
});

const resolveKeymap = (
  rawConfig: RawUserConfig,
  warnings: string[],
): Partial<Record<KeyboardActionId, string>> => {
  const nextKeymap: Partial<Record<KeyboardActionId, string>> = {
    ...DEFAULT_USER_CONFIG.keyboard.keymap,
  };

  for (const [action, value] of Object.entries(rawConfig.keymap ?? {})) {
    nextKeymap[action as KeyboardActionId] = coerceString(
      value,
      nextKeymap[action as KeyboardActionId] ?? '',
      `keymap.${action}`,
      warnings,
    );
  }

  return Object.fromEntries(
    Object.entries(nextKeymap).filter(([, value]) => typeof value === 'string' && value.trim()),
  ) as Partial<Record<KeyboardActionId, string>>;
};

const resolveUserConfig = (rawConfig: RawUserConfig, warnings: string[]): UserConfig => {
  const windowPadding = Math.round(
    clampNumber(
      coerceNumber(
        rawConfig.appearance?.windowPadding,
        DEFAULT_USER_CONFIG.appearance.windowPadding,
        'appearance.window_padding',
        warnings,
      ),
      0,
      64,
    ),
  );

  const backgroundOpacity = clampNumber(
    coerceNumber(
      rawConfig.appearance?.backgroundOpacity,
      DEFAULT_USER_CONFIG.appearance.backgroundOpacity,
      'appearance.background_opacity',
      warnings,
    ),
    0,
    1,
  );

  const textOpacity = clampNumber(
    coerceNumber(
      rawConfig.appearance?.textOpacity,
      DEFAULT_USER_CONFIG.appearance.textOpacity,
      'appearance.text_opacity',
      warnings,
    ),
    0,
    1,
  );

  const windowBorderRadius = Math.round(
    clampNumber(
      coerceNumber(
        rawConfig.appearance?.windowBorderRadius,
        DEFAULT_USER_CONFIG.appearance.windowBorderRadius,
        'appearance.window_border_radius',
        warnings,
      ),
      0,
      64,
    ),
  );

  const fontSize = Math.round(
    clampNumber(
      coerceNumber(
        rawConfig.appearance?.fontSize,
        DEFAULT_USER_CONFIG.appearance.fontSize,
        'appearance.font_size',
        warnings,
      ),
      10,
      28,
    ),
  );

  return {
    telegram: {
      ghostMode: coerceBoolean(
        rawConfig.telegram?.ghostMode,
        DEFAULT_USER_CONFIG.telegram.ghostMode,
        'telegram.ghost_mode',
        warnings,
      ),
      selectableMessageText: coerceBoolean(
        rawConfig.telegram?.selectableMessageText,
        DEFAULT_USER_CONFIG.telegram.selectableMessageText,
        'telegram.selectable_message_text',
        warnings,
      ),
      calls: {
        privateVoice: coerceBoolean(
          rawConfig.telegram?.privateVoiceCalls,
          DEFAULT_USER_CONFIG.telegram.calls.privateVoice,
          'telegram.private_voice_calls',
          warnings,
        ),
        privateVideo: coerceBoolean(
          rawConfig.telegram?.privateVideoCalls,
          DEFAULT_USER_CONFIG.telegram.calls.privateVideo,
          'telegram.private_video_calls',
          warnings,
        ),
        group: coerceBoolean(
          rawConfig.telegram?.groupCalls,
          DEFAULT_USER_CONFIG.telegram.calls.group,
          'telegram.group_calls',
          warnings,
        ),
      },
    },
    appearance: {
      windowPadding,
      windowBorderRadius,
      fontFamily: coerceString(
        rawConfig.appearance?.fontFamily,
        DEFAULT_USER_CONFIG.appearance.fontFamily,
        'appearance.font_family',
        warnings,
      ),
      fontSize,
      backgroundOpacity,
      textOpacity,
    },
    keyboard: {
      showHints: coerceBoolean(
        rawConfig.keyboard?.showHints,
        DEFAULT_USER_CONFIG.keyboard.showHints,
        'keyboard.show_hints',
        warnings,
      ),
      sendBehavior: coerceSendBehavior(
        rawConfig.keyboard?.sendBehavior,
        DEFAULT_USER_CONFIG.keyboard.sendBehavior,
        'keyboard.send_behavior',
        warnings,
      ),
      captureInWebview: coerceBoolean(
        rawConfig.keyboard?.captureInWebview,
        DEFAULT_USER_CONFIG.keyboard.captureInWebview,
        'keyboard.capture_in_webview',
        warnings,
      ),
      enableVimMode: coerceBoolean(
        rawConfig.keyboard?.enableVimMode,
        DEFAULT_USER_CONFIG.keyboard.enableVimMode,
        'keyboard.enable_vim_mode',
        warnings,
      ),
      enableCounts: coerceBoolean(
        rawConfig.keyboard?.enableCounts,
        DEFAULT_USER_CONFIG.keyboard.enableCounts,
        'keyboard.enable_counts',
        warnings,
      ),
      keymap: resolveKeymap(rawConfig, warnings),
    },
    shortcuts: resolveShortcutConfig(rawConfig, warnings),
  };
};

export const loadUserConfig = async (userDataPath: string): Promise<LoadedUserConfig> => {
  const configPath = path.join(userDataPath, USER_CONFIG_FILE_NAME);
  const warnings: string[] = [];

  await mkdir(path.dirname(configPath), { recursive: true });

  if (!fs.existsSync(configPath)) {
    await writeFile(configPath, DEFAULT_USER_CONFIG_TOML, 'utf8');
  }

  let source = DEFAULT_USER_CONFIG_TOML;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    warnings.push(
      `Failed to read ${configPath}: ${
        error instanceof Error ? error.message : 'unknown error'
      }. Using defaults.`,
    );
  }

  const parsed = parseUserConfigToml(source);
  warnings.push(...parsed.warnings);

  return {
    configPath,
    userConfig: resolveUserConfig(parsed.rawConfig, warnings),
    warnings,
  };
};
