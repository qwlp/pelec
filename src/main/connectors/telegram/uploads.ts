import path from 'node:path';
import type { ParsedDataUrl } from './types';

export const TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

const TELEGRAM_VOICE_NOTE_MIME_TYPES = new Set([
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/opus',
  'audio/webm',
  'audio/webm;codecs=opus',
]);

export const parseDataUrl = (dataUrl: string): ParsedDataUrl | undefined => {
  const trimmed = dataUrl.trim();
  if (!trimmed.toLowerCase().startsWith('data:')) {
    return undefined;
  }

  const commaIndex = trimmed.indexOf(',');
  if (commaIndex < 0) {
    return undefined;
  }

  const metadata = trimmed.slice(5, commaIndex);
  const base64 = trimmed.slice(commaIndex + 1);
  if (!metadata || !base64) {
    return undefined;
  }

  const lowerMetadata = metadata.toLowerCase();
  const base64MarkerIndex = lowerMetadata.lastIndexOf(';base64');
  if (base64MarkerIndex < 0) {
    return undefined;
  }

  const fullMimeType = metadata.slice(0, base64MarkerIndex).trim().toLowerCase();
  const essenceMimeType = fullMimeType.split(';')[0]?.trim() ?? '';
  if (!fullMimeType || !essenceMimeType || !essenceMimeType.includes('/')) {
    return undefined;
  }
  if (!/^[A-Za-z0-9+/=]+$/u.test(base64) || base64.length % 4 !== 0) {
    return undefined;
  }

  try {
    return {
      fullMimeType,
      essenceMimeType,
      bytes: Buffer.from(base64, 'base64'),
    };
  } catch {
    return undefined;
  }
};

export const extensionFromMime = (mimeType: string): string => {
  if (mimeType.startsWith('audio/webm')) {
    return '.webm';
  }
  if (mimeType === 'audio/ogg;codecs=opus') {
    return '.ogg';
  }
  if (mimeType.startsWith('audio/ogg')) {
    return '.ogg';
  }
  if (mimeType === 'audio/opus') {
    return '.opus';
  }
  if (mimeType === 'application/pdf') {
    return '.pdf';
  }
  if (mimeType === 'text/plain') {
    return '.txt';
  }
  if (mimeType === 'application/zip') {
    return '.zip';
  }
  if (mimeType === 'application/json') {
    return '.json';
  }
  if (mimeType === 'text/csv') {
    return '.csv';
  }
  if (mimeType === 'image/png') {
    return '.png';
  }
  if (mimeType === 'image/webp') {
    return '.webp';
  }
  if (mimeType === 'image/gif') {
    return '.gif';
  }
  if (mimeType === 'image/bmp') {
    return '.bmp';
  }
  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }
  if (mimeType === 'image/heic') {
    return '.heic';
  }
  if (mimeType === 'image/heif') {
    return '.heif';
  }
  if (mimeType === 'audio/mpeg') {
    return '.mp3';
  }
  if (mimeType === 'video/mp4') {
    return '.mp4';
  }
  if (mimeType === 'application/octet-stream') {
    return '.bin';
  }
  return '.bin';
};

export const sanitizeUploadFileName = (value: string): string => {
  const base = path
    .basename(value.trim())
    .replace(/[<>:"/\\|?*]/g, '_')
    .replaceAll(/[\n\r\t]/g, '_');
  const cleaned = [...base].map((char) => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  return cleaned || 'attachment';
};

export const resolveUploadFileName = (
  fileName: string | undefined,
  mimeType: string,
  fallbackBaseName: string,
): string => {
  const candidate = sanitizeUploadFileName(fileName?.trim() || fallbackBaseName);
  const parsed = path.parse(candidate);
  if (parsed.ext) {
    return candidate;
  }
  const ext = extensionFromMime(mimeType);
  return `${candidate}${ext}`;
};

export const isSupportedVoiceNoteMimeType = (mimeType: string): boolean =>
  TELEGRAM_VOICE_NOTE_MIME_TYPES.has(mimeType.trim().toLowerCase());
