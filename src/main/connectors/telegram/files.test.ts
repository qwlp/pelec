import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  localPathToDataUrl,
  resolveTdFilePath,
  resolveTdFileUrl,
  resolveTdPlayableFilePath,
} from './files';
import type { TdClient, TdFileRef } from './types';

describe('telegram file helpers', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('reads and caches local files as data urls', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pelec-telegram-files-test-'));
    const filePath = path.join(tempDir, 'image.png');
    await writeFile(filePath, Buffer.from('hello'));
    const cache = new Map<string, string>();

    const first = await localPathToDataUrl(filePath, cache);
    const second = await localPathToDataUrl(filePath, cache);

    expect(first).toBe('data:image/png;base64,aGVsbG8=');
    expect(second).toBe(first);
    expect(cache.get(filePath)).toBe(first);
  });

  it('downloads missing files through invokeWithTimeout', async () => {
    const invokeCalls: Array<Record<string, unknown>> = [];
    const local = await resolveTdFilePath({
      client: {} as TdClient,
      file: { id: 7 },
      downloadTimeoutMs: 500,
      invokeWithTimeout: async <T>(_client: TdClient, request: Record<string, unknown>) => {
        invokeCalls.push(request);
        return { local: { path: '/tmp/file.bin' } } as T;
      },
    });

    expect(local).toBe('/tmp/file.bin');
    expect(invokeCalls).toEqual([
      {
        _: 'downloadFile',
        file_id: 7,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true,
      },
    ]);
  });

  it('converts resolved td files into data urls', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pelec-telegram-files-test-'));
    const filePath = path.join(tempDir, 'voice.ogg');
    await writeFile(filePath, Buffer.from('voice'));

    const result = await resolveTdFileUrl({
      client: {} as TdClient,
      file: { local: { path: filePath } },
      downloadTimeoutMs: 500,
      mediaDataUrlCache: new Map<string, string>(),
      invokeWithTimeout: async <T>() => ({ local: { path: filePath } } as T),
      preferredMimeType: 'audio/ogg;codecs=opus',
    });

    expect(result).toBe('data:audio/ogg;codecs=opus;base64,dm9pY2U=');
  });

  it('polls incomplete playable files until the download completes', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const initialFile: TdFileRef = {
      id: 9,
      local: {
        path: '/tmp/incomplete.mp4',
        is_downloading_completed: false,
      },
    };

    const resolved = await resolveTdPlayableFilePath({
      client: {} as TdClient,
      file: initialFile,
      downloadTimeoutMs: 50,
      downloadPollIntervalMs: 1,
      invokeWithTimeout: async <T>(_client: TdClient, request: Record<string, unknown>) => {
        requests.push(request);
        if (request._ === 'downloadFile') {
          return {
            id: 9,
            local: {
              path: '/tmp/incomplete.mp4',
              is_downloading_completed: false,
            },
          } as T;
        }
        return {
          id: 9,
          local: {
            path: '/tmp/complete.mp4',
            is_downloading_completed: true,
          },
        } as T;
      },
    });

    expect(resolved).toBe('/tmp/complete.mp4');
    expect(requests[0]?._).toBe('downloadFile');
    expect(requests[1]?._).toBe('getFile');
  });
});
