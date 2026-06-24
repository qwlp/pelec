import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_USER_CONFIG,
  loadUserConfig,
  serializeUserConfig,
} from './userConfig';

describe('user config Vim mode setting', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('serializes the composer Vim mode toggle', () => {
    const config = structuredClone(DEFAULT_USER_CONFIG);
    config.keyboard.enableVimMode = false;

    expect(serializeUserConfig(config)).toContain('enable_vim_mode = false');
  });

  it('loads the composer Vim mode toggle and defaults existing configs to enabled', async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'pelec-user-config-'));
    temporaryDirectories.push(userDataPath);

    await loadUserConfig(userDataPath);
    const configPath = path.join(userDataPath, 'config.toml');
    const source = await readFile(configPath, 'utf8');
    await writeFile(configPath, source.replace('enable_vim_mode = true', 'enable_vim_mode = false'));

    const disabled = await loadUserConfig(userDataPath);
    expect(disabled.userConfig.keyboard.enableVimMode).toBe(false);

    await writeFile(configPath, source.replace('enable_vim_mode = true\n', ''));
    const missing = await loadUserConfig(userDataPath);
    expect(missing.userConfig.keyboard.enableVimMode).toBe(true);
  });
});
