import fs, { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { PELEC_MEDIA_SCHEME } from './config';

const mediaContentTypeForPath = (localPath: string): string => {
  const ext = localPath.slice(localPath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.m4v':
      return 'video/x-m4v';
    case '.ogv':
      return 'video/ogg';
    default:
      return 'application/octet-stream';
  }
};

const parseRangeHeader = (
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | null => {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) {
    return null;
  }

  let start: number;
  let end: number;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
};

export const registerMediaProtocol = (): void => {
  protocol.handle(PELEC_MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const localPath = url.searchParams.get('path')?.trim();
      if (!localPath) {
        return new Response('Missing path', { status: 400 });
      }

      const stats = await fs.promises.stat(localPath);
      if (!stats.isFile()) {
        return new Response('Not found', { status: 404 });
      }

      const contentType = mediaContentTypeForPath(localPath);
      const range = parseRangeHeader(request.headers.get('range'), stats.size);
      const method = request.method.toUpperCase();

      if (method === 'HEAD') {
        return new Response(null, {
          status: range ? 206 : 200,
          headers: range
            ? {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(range.end - range.start + 1),
                'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
                'Content-Type': contentType,
                'Cache-Control': 'no-store',
              }
            : {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(stats.size),
                'Content-Type': contentType,
                'Cache-Control': 'no-store',
              },
        });
      }

      if (range) {
        const stream = createReadStream(localPath, {
          start: range.start,
          end: range.end,
        });
        return new Response(Readable.toWeb(stream) as BodyInit, {
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(range.end - range.start + 1),
            'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
          },
        });
      }

      const stream = createReadStream(localPath);
      return new Response(Readable.toWeb(stream) as BodyInit, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(stats.size),
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('Invalid media URL', { status: 400 });
    }
  });
};
