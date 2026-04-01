import { app, clipboard } from 'electron';
import fs, { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import type { ResolvedDocument } from '../shared/connectors';
import { writeLinuxClipboardWithUtility } from './platform';

const sanitizeDownloadFileName = (
  value: string | undefined,
  fallback = 'telegram-document',
): string => {
  const base = path
    .basename(value?.trim() || fallback)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replaceAll(/[\n\r\t]/g, '_');
  const cleaned = [...base].map((char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  return cleaned || fallback;
};

const resolveUniqueDownloadPath = (downloadsDir: string, fileName: string): string => {
  const parsed = path.parse(fileName);
  const stem = parsed.name || 'telegram-document';
  const ext = parsed.ext || '';
  let attempt = path.join(downloadsDir, `${stem}${ext}`);
  let index = 1;

  while (fs.existsSync(attempt)) {
    attempt = path.join(downloadsDir, `${stem} (${index})${ext}`);
    index += 1;
  }

  return attempt;
};

export const saveResolvedDocumentToDownloads = async (
  document: ResolvedDocument,
  onProgress?: (progress: number) => void,
): Promise<string | undefined> => {
  const sourcePath = document.filePath.trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return undefined;
  }

  const downloadsDir = app.getPath('downloads');
  await mkdir(downloadsDir, { recursive: true });
  const preferredName =
    document.fileName && document.fileName !== 'Document'
      ? document.fileName
      : path.basename(sourcePath);

  const targetPath = resolveUniqueDownloadPath(
    downloadsDir,
    sanitizeDownloadFileName(preferredName, path.basename(sourcePath)),
  );

  if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
    const totalBytes = Math.max(document.sizeBytes ?? fs.statSync(sourcePath).size, 0);
    await new Promise<void>((resolve, reject) => {
      let copiedBytes = 0;
      let lastReportedProgress = -1;
      let lastReportAt = 0;
      const reader = createReadStream(sourcePath);
      const writer = createWriteStream(targetPath, { flags: 'wx' });

      reader.on('data', (chunk: Buffer | string) => {
        copiedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
        if (totalBytes > 0) {
          const progress = Math.min(copiedBytes / totalBytes, 1);
          const now = Date.now();
          if (
            progress === 1 ||
            progress - lastReportedProgress >= 0.02 ||
            now - lastReportAt >= 90
          ) {
            lastReportedProgress = progress;
            lastReportAt = now;
            onProgress?.(progress);
          }
        }
      });

      const fail = (error: unknown) => {
        reader.destroy();
        writer.destroy();
        void rm(targetPath, { force: true }).catch(() => {
          // Best-effort cleanup for partial files.
        });
        reject(error);
      };

      reader.on('error', fail);
      writer.on('error', fail);

      reader.pipe(writer);
      void finished(writer)
        .then(() => {
          onProgress?.(1);
          resolve();
        })
        .catch(fail);
    });
  } else {
    onProgress?.(1);
  }

  if (!fs.existsSync(targetPath)) {
    return undefined;
  }

  try {
    app.addRecentDocument(targetPath);
  } catch {
    // Best-effort OS integration only.
  }

  return targetPath;
};

export const copyResolvedDocumentToClipboard = async (
  document: ResolvedDocument,
): Promise<boolean> => {
  const sourcePath = document.filePath.trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  const fileUrl = pathToFileURL(sourcePath).toString();

  try {
    clipboard.clear();
    clipboard.write({ text: sourcePath });
    clipboard.writeBuffer('text/plain', Buffer.from(sourcePath, 'utf8'));
    clipboard.writeBuffer('text/plain;charset=utf-8', Buffer.from(sourcePath, 'utf8'));
    clipboard.writeBuffer('text/uri-list', Buffer.from(`${fileUrl}\n`, 'utf8'));

    if (process.platform === 'linux') {
      const linuxCopyPayload = Buffer.from(`copy\n${fileUrl}\n`, 'utf8');
      clipboard.writeBuffer('x-special/gnome-copied-files', linuxCopyPayload);
      clipboard.writeBuffer('x-special/nautilus-clipboard', linuxCopyPayload);
    }

    if (process.platform === 'darwin' || process.platform === 'win32') {
      clipboard.writeBookmark(path.basename(sourcePath), fileUrl);
    }

    if (process.platform !== 'linux') {
      return true;
    }

    const formats = clipboard.availableFormats();
    if (
      formats.includes('x-special/gnome-copied-files') ||
      formats.includes('x-special/nautilus-clipboard')
    ) {
      return true;
    }

    return writeLinuxClipboardWithUtility(fileUrl);
  } catch {
    return false;
  }
};
