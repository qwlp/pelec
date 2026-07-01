import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTelegramMediaCache,
  getTelegramMediaCachePath,
  getTelegramMediaCacheSize,
} from './telegramCache';

describe('Telegram media cache', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  const createUserDataPath = async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'pelec-telegram-cache-'));
    temporaryDirectories.push(userDataPath);
    return userDataPath;
  };

  it('reports zero when the media cache has not been created', async () => {
    const userDataPath = await createUserDataPath();

    await expect(getTelegramMediaCacheSize(userDataPath)).resolves.toBe(0);
  });

  it('counts nested Telegram media cache files', async () => {
    const userDataPath = await createUserDataPath();
    const cachePath = getTelegramMediaCachePath(userDataPath);

    await mkdir(path.join(cachePath, 'photos'), { recursive: true });
    await writeFile(path.join(cachePath, 'photos', 'one.bin'), Buffer.alloc(7));
    await writeFile(path.join(cachePath, 'two.bin'), Buffer.alloc(11));

    await expect(getTelegramMediaCacheSize(userDataPath)).resolves.toBe(18);
  });

  it('clears media cache contents and leaves the cache root in place', async () => {
    const userDataPath = await createUserDataPath();
    const cachePath = getTelegramMediaCachePath(userDataPath);

    await mkdir(path.join(cachePath, 'videos'), { recursive: true });
    await writeFile(path.join(cachePath, 'videos', 'clip.bin'), Buffer.alloc(13));

    await clearTelegramMediaCache(userDataPath);

    await expect(readdir(cachePath)).resolves.toEqual([]);
    await expect(getTelegramMediaCacheSize(userDataPath)).resolves.toBe(0);
  });
});
