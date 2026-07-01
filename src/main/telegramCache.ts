import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const getTelegramMediaCachePath = (userDataPath: string): string =>
  path.join(userDataPath, 'tdlib-files', 'telegram');

const isMissingPathError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

export const getDirectorySizeBytes = async (directoryPath: string): Promise<number> => {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return 0;
    }
    throw error;
  }

  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return getDirectorySizeBytes(entryPath);
      }

      try {
        return (await stat(entryPath)).size;
      } catch (error) {
        if (isMissingPathError(error)) {
          return 0;
        }
        throw error;
      }
    }),
  );

  return sizes.reduce((total, size) => total + size, 0);
};

export const clearDirectoryContents = async (directoryPath: string): Promise<void> => {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      await mkdir(directoryPath, { recursive: true });
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map((entry) =>
      rm(path.join(directoryPath, entry.name), {
        recursive: entry.isDirectory(),
        force: true,
      }),
    ),
  );
};

export const getTelegramMediaCacheSize = async (userDataPath: string): Promise<number> =>
  getDirectorySizeBytes(getTelegramMediaCachePath(userDataPath));

export const clearTelegramMediaCache = async (userDataPath: string): Promise<void> => {
  const cachePath = getTelegramMediaCachePath(userDataPath);
  await clearDirectoryContents(cachePath);
  await mkdir(cachePath, { recursive: true });
};
