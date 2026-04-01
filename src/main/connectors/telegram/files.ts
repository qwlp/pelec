import { readFile } from 'node:fs/promises';
import { inferTelegramLocalMimeType } from './media';
import type { TdClient, TdFileRef } from './types';

type InvokeWithTimeout = <T>(
  client: TdClient,
  request: Record<string, unknown>,
  label: string,
  timeoutMs?: number,
) => Promise<T>;

type FileResolverOptions = {
  client: TdClient;
  file: TdFileRef | undefined;
  invokeWithTimeout: InvokeWithTimeout;
  downloadTimeoutMs: number;
};

const isTdFileDownloadComplete = (file: TdFileRef | undefined): boolean =>
  file?.local?.is_downloading_completed === true && !!file.local?.path?.trim();

const getTdFileSize = (file: TdFileRef | undefined): number | undefined => {
  const size = Number(file?.size ?? file?.expected_size ?? 0);
  return Number.isFinite(size) && size > 0 ? size : undefined;
};

const logIncompleteVideoFile = (file: TdFileRef | undefined, context: string): void => {
  console.warn(`[telegram-video] ${context}`, {
    fileId: file?.id,
    path: file?.local?.path?.trim() || undefined,
    isDownloadingActive: file?.local?.is_downloading_active === true,
    isDownloadingCompleted: file?.local?.is_downloading_completed === true,
    downloadedPrefixSize:
      Number.isFinite(Number(file?.local?.downloaded_prefix_size))
        ? Number(file?.local?.downloaded_prefix_size)
        : undefined,
    size: getTdFileSize(file),
  });
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const localPathToDataUrl = async (
  localPath: string,
  mediaDataUrlCache: Map<string, string>,
  preferredMimeType?: string,
): Promise<string | undefined> => {
  const cached = mediaDataUrlCache.get(localPath);
  if (cached) {
    return cached;
  }

  try {
    const bytes = await readFile(localPath);
    const mimeType = inferTelegramLocalMimeType(localPath, preferredMimeType);
    const value = `data:${mimeType};base64,${bytes.toString('base64')}`;
    mediaDataUrlCache.set(localPath, value);
    return value;
  } catch {
    return undefined;
  }
};

export const resolveTdFilePath = async ({
  client,
  file,
  invokeWithTimeout,
  downloadTimeoutMs,
}: FileResolverOptions): Promise<string | undefined> => {
  const localPath = file?.local?.path?.trim();
  if (localPath) {
    return localPath;
  }

  const fileId = file?.id;
  if (!fileId) {
    return undefined;
  }

  try {
    const downloaded = await invokeWithTimeout<TdFileRef>(
      client,
      {
        _: 'downloadFile',
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true,
      },
      'downloadFile',
      downloadTimeoutMs,
    );
    return downloaded.local?.path?.trim() || undefined;
  } catch {
    return undefined;
  }
};

export const resolveTdFileUrl = async ({
  client,
  file,
  invokeWithTimeout,
  downloadTimeoutMs,
  mediaDataUrlCache,
  preferredMimeType,
}: FileResolverOptions & {
  mediaDataUrlCache: Map<string, string>;
  preferredMimeType?: string;
}): Promise<string | undefined> => {
  const localPath = await resolveTdFilePath({
    client,
    file,
    invokeWithTimeout,
    downloadTimeoutMs,
  });
  if (!localPath) {
    return undefined;
  }

  return localPathToDataUrl(localPath, mediaDataUrlCache, preferredMimeType);
};

export const resolveTdPlayableFilePath = async ({
  client,
  file,
  invokeWithTimeout,
  downloadTimeoutMs,
  downloadPollIntervalMs,
}: FileResolverOptions & {
  downloadPollIntervalMs: number;
}): Promise<string | undefined> => {
  if (isTdFileDownloadComplete(file)) {
    return file?.local?.path?.trim();
  }

  if (file?.local?.path?.trim()) {
    logIncompleteVideoFile(file, 'Video file path exists before download completed.');
  }

  const fileId = file?.id;
  if (!fileId) {
    return undefined;
  }

  const startedAt = Date.now();
  let latestFile = file;

  try {
    latestFile = await invokeWithTimeout<TdFileRef>(
      client,
      {
        _: 'downloadFile',
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true,
      },
      'downloadFile',
      downloadTimeoutMs,
    );
  } catch {
    return undefined;
  }

  if (isTdFileDownloadComplete(latestFile)) {
    return latestFile.local?.path?.trim();
  }

  if (latestFile?.local?.path?.trim()) {
    logIncompleteVideoFile(
      latestFile,
      'downloadFile returned an incomplete Telegram video file.',
    );
  }

  while (Date.now() - startedAt < downloadTimeoutMs) {
    await sleep(downloadPollIntervalMs);
    try {
      latestFile = await invokeWithTimeout<TdFileRef>(
        client,
        {
          _: 'getFile',
          file_id: fileId,
        },
        'getFile',
        downloadPollIntervalMs * 2,
      );
    } catch {
      continue;
    }

    if (isTdFileDownloadComplete(latestFile)) {
      return latestFile.local?.path?.trim();
    }
  }

  logIncompleteVideoFile(
    latestFile,
    'Timed out waiting for Telegram video download to complete.',
  );
  return undefined;
};
