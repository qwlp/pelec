import type { ChatMessage } from '../../../shared/connectors';
import { formatFileSize, safeLabel, safeText } from '../../lib/format';

export type PendingTelegramAttachment = {
  id: string;
  kind: 'image' | 'document' | 'voice';
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  dataUrl: string;
};

export const TELEGRAM_MAX_ATTACHMENTS = 10;
export const TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
export const TELEGRAM_VOICE_RECORDING_MIN_DURATION_MS = 250;

const TELEGRAM_VOICE_NOTE_MIME_TYPES = new Set([
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/opus',
  'audio/webm',
  'audio/webm;codecs=opus',
]);

const TELEGRAM_VOICE_RECORDING_MIME_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/webm;codecs=opus',
  'audio/webm',
];

export const createTelegramAttachmentId = (): string =>
  `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const readBlobAsDataUrl = (blob: Blob): Promise<string | null> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });

export const readFileAsDataUrl = (file: File): Promise<string | null> => readBlobAsDataUrl(file);

export const getSupportedTelegramVoiceRecordingMimeType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') {
    return undefined;
  }

  return TELEGRAM_VOICE_RECORDING_MIME_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
};

export const getTelegramVoiceRecordingFileName = (mimeType: string): string =>
  mimeType.includes('ogg') ? 'voice-note.ogg' : 'voice-note.webm';

export const getTelegramAttachmentKind = (
  mimeType?: string,
): PendingTelegramAttachment['kind'] => {
  const normalizedMimeType = (mimeType ?? '').toLowerCase();
  if (normalizedMimeType.startsWith('image/')) {
    return 'image';
  }
  if (TELEGRAM_VOICE_NOTE_MIME_TYPES.has(normalizedMimeType)) {
    return 'voice';
  }
  return 'document';
};

export const formatTelegramAttachmentMeta = (attachment: PendingTelegramAttachment): string => {
  const detail =
    attachment.kind === 'voice'
      ? 'Voice note'
      : safeLabel(attachment.mimeType, attachment.kind === 'image' ? 'Image' : 'Document');
  const size = formatFileSize(attachment.sizeBytes);
  return size ? `${detail} • ${size}` : detail;
};

export const formatTelegramDocumentKind = (
  fileName: string | undefined,
  mimeType?: string,
): string => {
  const normalizedFileName = safeLabel(fileName, 'FILE');
  const ext = normalizedFileName.split('.').pop()?.trim();
  if (ext && ext !== normalizedFileName) {
    return ext.slice(0, 8).toUpperCase();
  }
  if (mimeType) {
    return mimeType.split('/').pop()?.slice(0, 8).toUpperCase() || 'FILE';
  }
  return 'FILE';
};

export const formatTelegramDocumentSubtitle = (
  fileName: string | undefined,
  mimeType?: string,
  sizeBytes?: number,
): string => {
  const size = formatFileSize(sizeBytes);
  if (size) {
    return size;
  }

  const kind = formatTelegramDocumentKind(fileName, mimeType);
  return kind === 'FILE' ? 'Telegram document' : kind;
};

export const isTelegramDocumentFallbackText = (message: ChatMessage): boolean => {
  if (!message.document) {
    return false;
  }

  const text = safeText(message.text).trim().toLowerCase();
  if (!text) {
    return false;
  }

  const fileName = safeLabel(message.document.fileName, 'Document');
  return text === 'document' || text === `document: ${fileName}`.toLowerCase();
};

export const isTelegramImageFallbackText = (message: ChatMessage): boolean => {
  if (!message.imageUrl) {
    return false;
  }

  const text = safeText(message.text).trim().toLowerCase();
  if (!text) {
    return false;
  }

  return text === 'image' || text === 'photo' || text === 'document/image' || text === 'document';
};

export const isTelegramAlbumEligibleMessage = (message: ChatMessage): boolean =>
  !!message.mediaAlbumId &&
  (!!message.imageUrl || !!message.videoUrl || !!message.hasVideo) &&
  !message.document &&
  !message.animationUrl &&
  !message.stickerUrl &&
  !message.call &&
  !(message.audioUrl || message.hasAudio);

export const isTelegramVideoFallbackText = (message: ChatMessage): boolean => {
  if (!message.videoUrl && !message.hasVideo) {
    return false;
  }

  const text = safeText(message.text).trim().toLowerCase();
  if (!text) {
    return false;
  }

  return text === 'video' || text === 'video message' || text === '[video]' || text === '[media]';
};

export const getTelegramMeaningfulAlbumCaption = (
  message: ChatMessage,
): string | undefined => {
  const text = safeText(message.text).trim();
  if (!text) {
    return undefined;
  }
  if (
    isTelegramImageFallbackText(message) ||
    isTelegramVideoFallbackText(message) ||
    isTelegramDocumentFallbackText(message)
  ) {
    return undefined;
  }
  return text;
};

export const extractLocalMediaPath = (mediaUrl: string): string | undefined => {
  try {
    const parsed = new URL(mediaUrl);
    const filePath = parsed.searchParams.get('path')?.trim();
    return filePath || undefined;
  } catch {
    return undefined;
  }
};

export const buildVoiceBarHeights = (seed: string, count = 38): number[] => {
  let value = 0;
  for (let i = 0; i < seed.length; i += 1) {
    value = (value * 33 + seed.charCodeAt(i)) >>> 0;
  }
  if (value === 0) {
    value = 0x9e3779b9;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    bars.push(20 + (value % 68));
  }
  return bars;
};
