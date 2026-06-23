import type { ChatDocument, TelegramPickerItem } from '../../../shared/connectors';
import type { TdAnimation, TdFileRef, TdSticker, TelegramDocumentRef } from './types';

export const buildTelegramLocalMediaUrl = (
  localPath: string,
  scheme = 'pelec-media',
  mimeType?: string,
): string => {
  const mediaUrl = new URL(`${scheme}://local/`);
  mediaUrl.searchParams.set('path', localPath);
  if (mimeType?.trim()) {
    mediaUrl.searchParams.set('mime', mimeType.trim().toLowerCase());
  }
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

export const getTelegramImageFile = (content: unknown): TdFileRef | undefined => {
  const imageDocument = extractTelegramImageDocumentSource(content);
  if (imageDocument?.file) {
    return imageDocument.file;
  }
  return extractTelegramPhotoFiles(content).at(-1);
};

export const getTelegramFileSizeBytes = (file: TdFileRef | undefined): number | undefined => {
  const size = Number(file?.size ?? file?.expected_size ?? 0);
  return Number.isFinite(size) && size > 0 ? size : undefined;
};

export const isTelegramStickerAnimatedFormat = (format: string | undefined): boolean =>
  format === 'stickerFormatTgs' || format === 'stickerFormatWebm';

export const getTelegramStickerPreviewFile = (sticker: TdSticker | undefined): TdFileRef | undefined => {
  if (!sticker) {
    return undefined;
  }

  const format = sticker.format?._;
  if (isTelegramStickerAnimatedFormat(format) && format !== 'stickerFormatWebm') {
    return sticker.thumbnail?.file ?? sticker.sticker;
  }

  return sticker.sticker ?? sticker.thumbnail?.file;
};

export const getTelegramAnimationPreviewFile = (
  animation: TdAnimation | undefined,
): TdFileRef | undefined => {
  if (!animation) {
    return undefined;
  }

  return animation.thumbnail?.file ?? animation.animation;
};

const tdFileIdToPickerId = (file: TdFileRef | undefined): string | undefined => {
  const fileId = file?.id;
  if (!fileId) {
    return undefined;
  }
  return String(fileId);
};

const getPositiveDimension = (value: unknown): number | undefined => {
  const dimension = Math.floor(Number(value ?? 0));
  return Number.isFinite(dimension) && dimension > 0 ? dimension : undefined;
};

export const mapTelegramStickerToPickerItem = (
  sticker: TdSticker | undefined,
  previewUrl: string | undefined,
  previewMimeType?: string,
  setTitle?: string,
): TelegramPickerItem | undefined => {
  const id = tdFileIdToPickerId(sticker?.sticker);
  if (!id || !previewUrl) {
    return undefined;
  }

  const emoji = sticker?.emoji?.trim() || undefined;
  const format = sticker?.format?._;
  return {
    id,
    kind: 'sticker',
    previewUrl,
    previewMimeType,
    emoji,
    setTitle: setTitle?.trim() || undefined,
    animated: isTelegramStickerAnimatedFormat(format),
    width: getPositiveDimension(sticker?.width),
    height: getPositiveDimension(sticker?.height),
  };
};

export const mapTelegramAnimationToPickerItem = (
  animation: TdAnimation | undefined,
  previewUrl: string | undefined,
  previewMimeType?: string,
): TelegramPickerItem | undefined => {
  const id = tdFileIdToPickerId(animation?.animation);
  if (!id || !previewUrl) {
    return undefined;
  }

  return {
    id,
    kind: 'gif',
    previewUrl,
    previewMimeType,
    animated: true,
    width: getPositiveDimension(animation?.width),
    height: getPositiveDimension(animation?.height),
  };
};

export const extractTelegramStickerSource = (
  content: unknown,
): { sticker?: TdFileRef; thumbnail?: TdFileRef; animated: boolean; format?: string } | undefined => {
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
  const animated = isTelegramStickerAnimatedFormat(format);

  return {
    sticker: container.sticker?.sticker,
    thumbnail: container.sticker?.thumbnail?.file,
    animated,
    format,
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

export const extractTelegramVideoThumbnailFile = (content: unknown): TdFileRef | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    video?: { thumbnail?: { file?: TdFileRef } };
    video_note?: { thumbnail?: { file?: TdFileRef } };
  };

  if (container._ === 'messageVideo') {
    return container.video?.thumbnail?.file;
  }
  if (container._ === 'messageVideoNote') {
    return container.video_note?.thumbnail?.file;
  }
  return undefined;
};

export const extractTelegramVideoDimensions = (
  content: unknown,
): { width: number; height: number } | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    video?: { width?: number; height?: number };
  };

  if (container._ === 'messageVideoNote') {
    return { width: 1, height: 1 };
  }
  if (container._ !== 'messageVideo') {
    return undefined;
  }

  const width = Math.floor(Number(container.video?.width ?? 0));
  const height = Math.floor(Number(container.video?.height ?? 0));
  if (width < 1 || height < 1) {
    return undefined;
  }
  return { width, height };
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
    return 'video/webm';
  }
  if (lowerPath.endsWith('.tgs')) {
    return 'application/x-tgsticker';
  }
  if (lowerPath.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (lowerPath.endsWith('.mov')) {
    return 'video/quicktime';
  }
  if (lowerPath.endsWith('.m4v')) {
    return 'video/x-m4v';
  }
  if (lowerPath.endsWith('.ogv')) {
    return 'video/ogg';
  }
  return 'image/jpeg';
};
