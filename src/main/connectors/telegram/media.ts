import type { ChatDocument } from '../../../shared/connectors';
import type { TdFileRef, TelegramDocumentRef } from './types';

export const buildTelegramLocalMediaUrl = (
  localPath: string,
  scheme = 'pelec-media',
): string => {
  const mediaUrl = new URL(`${scheme}://local/`);
  mediaUrl.searchParams.set('path', localPath);
  return mediaUrl.toString();
};

export const extractTelegramImageDocumentSource = (
  content: unknown,
): { file: TdFileRef | undefined; mimeType: string } | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    document?: {
      mime_type?: string;
      document?: TdFileRef;
    };
  };

  if (container._ !== 'messageDocument') {
    return undefined;
  }

  const mimeType = container.document?.mime_type?.trim().toLowerCase() ?? '';
  if (!mimeType.startsWith('image/')) {
    return undefined;
  }

  return {
    file: container.document?.document,
    mimeType,
  };
};

export const extractTelegramPhotoFiles = (content: unknown): TdFileRef[] => {
  if (!content || typeof content !== 'object') {
    return [];
  }

  const container = content as {
    _?: string;
    photo?: { sizes?: Array<{ photo?: TdFileRef }> };
  };

  if (container._ !== 'messagePhoto') {
    return [];
  }

  return (container.photo?.sizes ?? [])
    .map((size) => size.photo)
    .filter((photo): photo is TdFileRef => photo !== undefined);
};

export const extractTelegramStickerSource = (
  content: unknown,
): { sticker?: TdFileRef; thumbnail?: TdFileRef; animated: boolean } | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    sticker?: {
      sticker?: TdFileRef;
      thumbnail?: { file?: TdFileRef };
      format?: { _?: string };
    };
  };

  if (container._ !== 'messageSticker') {
    return undefined;
  }

  const format = container.sticker?.format?._;
  const animated = format === 'stickerFormatTgs' || format === 'stickerFormatWebm';

  return {
    sticker: container.sticker?.sticker,
    thumbnail: container.sticker?.thumbnail?.file,
    animated,
  };
};

export const extractTelegramAnimationSource = (
  content: unknown,
): { file: TdFileRef | undefined; mimeType?: string } | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    animation?: {
      mime_type?: string;
      animation?: TdFileRef;
    };
  };

  if (container._ !== 'messageAnimation') {
    return undefined;
  }

  return {
    file: container.animation?.animation,
    mimeType: container.animation?.mime_type?.trim().toLowerCase() || undefined,
  };
};

export const extractTelegramVideoFile = (content: unknown): TdFileRef | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    video?: {
      video?: TdFileRef;
    };
    video_note?: {
      video?: TdFileRef;
    };
  };

  if (container._ === 'messageVideo') {
    return container.video?.video;
  }
  if (container._ === 'messageVideoNote') {
    return container.video_note?.video;
  }
  return undefined;
};

export const extractTelegramVoiceNoteFile = (content: unknown): TdFileRef | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    voice_note?: { voice?: TdFileRef };
  };

  if (container._ !== 'messageVoiceNote') {
    return undefined;
  }

  return container.voice_note?.voice;
};

export const getTelegramDocument = (content: unknown): TelegramDocumentRef | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    document?: {
      file_name?: string;
      mime_type?: string;
      document?: TdFileRef;
    };
  };

  if (container._ !== 'messageDocument') {
    return undefined;
  }

  const mimeType = container.document?.mime_type?.trim().toLowerCase() || undefined;
  if (mimeType?.startsWith('image/')) {
    return undefined;
  }

  const file = container.document?.document;
  const fileName = container.document?.file_name?.trim() || 'Document';
  const rawSize = Number(file?.size ?? file?.expected_size ?? 0);
  const sizeBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : undefined;

  return {
    file,
    fileName,
    mimeType,
    sizeBytes,
  };
};

export const extractTelegramDocumentMetadata = (content: unknown): ChatDocument | undefined => {
  const document = getTelegramDocument(content);
  if (!document) {
    return undefined;
  }

  return {
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
  };
};

export const hasTelegramVideo = (content: unknown): boolean => {
  if (!content || typeof content !== 'object') {
    return false;
  }

  const kind = (content as { _?: string })._;
  return kind === 'messageVideo' || kind === 'messageVideoNote';
};

export const extractTelegramVoiceDurationSeconds = (content: unknown): number | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }
  const container = content as {
    _?: string;
    voice_note?: { duration?: number };
  };
  if (container._ !== 'messageVoiceNote') {
    return undefined;
  }
  const duration = container.voice_note?.duration;
  if (!duration || duration < 1) {
    return undefined;
  }
  return Math.floor(duration);
};

export const hasTelegramVoiceNote = (content: unknown): boolean => {
  if (!content || typeof content !== 'object') {
    return false;
  }
  return (content as { _?: string })._ === 'messageVoiceNote';
};

export const extractTelegramAnimationMimeType = (content: unknown): string | undefined =>
  extractTelegramAnimationSource(content)?.mimeType;

export const extractTelegramVideoMimeType = (content: unknown): string | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }
  const container = content as {
    _?: string;
    video?: { mime_type?: string };
    video_note?: { mime_type?: string };
  };
  if (container._ === 'messageVideo') {
    return container.video?.mime_type?.trim().toLowerCase() || undefined;
  }
  if (container._ === 'messageVideoNote') {
    return container.video_note?.mime_type?.trim().toLowerCase() || 'video/mp4';
  }
  return undefined;
};

export const extractTelegramStickerEmoji = (content: unknown): string | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }
  const container = content as { _?: string; emoji?: string };
  if (container._ !== 'messageSticker') {
    return undefined;
  }
  const emoji = container.emoji?.trim();
  return emoji || undefined;
};

export const isTelegramAnimatedSticker = (content: unknown): boolean =>
  extractTelegramStickerSource(content)?.animated === true;

export const inferTelegramLocalMimeType = (
  localPath: string,
  preferredMimeType?: string,
): string => {
  if (preferredMimeType) {
    return preferredMimeType;
  }

  const lowerPath = localPath.toLowerCase();
  if (lowerPath.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerPath.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerPath.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lowerPath.endsWith('.ogg') || lowerPath.endsWith('.oga') || lowerPath.endsWith('.opus')) {
    return 'audio/ogg;codecs=opus';
  }
  if (lowerPath.endsWith('.mp3')) {
    return 'audio/mpeg';
  }
  if (lowerPath.endsWith('.m4a')) {
    return 'audio/mp4';
  }
  if (lowerPath.endsWith('.aac')) {
    return 'audio/aac';
  }
  if (lowerPath.endsWith('.wav')) {
    return 'audio/wav';
  }
  if (lowerPath.endsWith('.webm')) {
    return 'audio/webm';
  }
  return 'image/jpeg';
};
