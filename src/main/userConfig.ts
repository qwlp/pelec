import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { UserConfig } from '../shared/types';

type RawUserConfig = {
  telegram?: {
    ghostMode?: unknown;
  };
  appearance?: {
    windowPadding?: unknown;
    windowBorderRadius?: unknown;
    fontFamily?: unknown;
    fontSize?: unknown;
    backgroundOpacity?: unknown;
    textOpacity?: unknown;
  };
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

export const DEFAULT_USER_CONFIG: UserConfig = {
  telegram: {
    ghostMode: false,
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
};

const USER_CONFIG_FILE_NAME = 'config.toml';

const DEFAULT_USER_CONFIG_TOML = `# PELEC user config
# Restart the app after editing this file.

[telegram]
# When true, Telegram chats are fetched without opening the chat watcher.
ghost_mode = false

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
`;

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
  let section: 'telegram' | 'appearance' | null = null;

  for (const [lineIndex, originalLine] of source.split(/\r?\n/u).entries()) {
    const withoutComment = stripTomlComment(originalLine).trim();
    if (!withoutComment) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_-]+)\]$/u.exec(withoutComment);
    if (sectionMatch) {
      const nextSection = sectionMatch[1];
      if (nextSection === 'telegram' || nextSection === 'appearance') {
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
      } else {
        warnings.push(`Ignoring unknown telegram key "${key}" on line ${lineIndex + 1}.`);
      }
      continue;
    }

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
