import { describe, expect, it } from 'vitest';
import {
  buildTelegramLocalMediaUrl,
  extractTelegramAnimationMimeType,
  extractTelegramAnimationSource,
  extractTelegramDocumentMetadata,
  extractTelegramImageName,
  extractTelegramImageDocumentSource,
  extractTelegramPhotoFiles,
  extractTelegramStickerEmoji,
  extractTelegramStickerSource,
  extractTelegramVideoDimensions,
  extractTelegramVideoFile,
  extractTelegramVideoMimeType,
  extractTelegramVideoThumbnailFile,
  extractTelegramVoiceDurationSeconds,
  extractTelegramVoiceNoteFile,
  getTelegramDocument,
  hasTelegramVideo,
  hasTelegramVoiceNote,
  inferTelegramLocalMimeType,
  isTelegramAnimatedSticker,
  getTelegramAnimationPreviewFile,
  getTelegramStickerPreviewFile,
  mapTelegramAnimationToPickerItem,
  mapTelegramStickerToPickerItem,
} from './media';

describe('telegram media helpers', () => {
  it('extracts document and image metadata from Telegram content', () => {
    expect(
      extractTelegramImageDocumentSource({
        _: 'messageDocument',
        document: {
          mime_type: 'image/png',
          document: { id: 7 },
        },
      }),
    ).toEqual({
      file: { id: 7 },
      mimeType: 'image/png',
    });

    expect(
      extractTelegramImageName({
        _: 'messageDocument',
        document: {
          file_name: 'photo.png',
          mime_type: 'image/png',
          document: { id: 7 },
        },
      }),
    ).toBe('photo.png');

    expect(
      extractTelegramDocumentMetadata({
        _: 'messageDocument',
        document: {
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          document: { id: 8, size: 2048 },
        },
      }),
    ).toEqual({
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });

    expect(
      getTelegramDocument({
        _: 'messageDocument',
        document: {
          file_name: 'photo.png',
          mime_type: 'image/png',
          document: { id: 1 },
        },
      }),
    ).toBeUndefined();

    expect(
      extractTelegramImageName({
        _: 'messagePhoto',
        photo: {
          sizes: [{ photo: { id: 1 } }],
        },
      }, 123456789),
    ).toBe('photo-123456789.jpg');
  });

  it('extracts photo, sticker, animation, video, and voice file refs', () => {
    expect(
      extractTelegramPhotoFiles({
        _: 'messagePhoto',
        photo: {
          sizes: [{ photo: { id: 1 } }, { photo: { id: 2, local: { path: '/tmp/full.jpg' } } }],
        },
      }),
    ).toEqual([{ id: 1 }, { id: 2, local: { path: '/tmp/full.jpg' } }]);

    expect(
      extractTelegramStickerSource({
        _: 'messageSticker',
        sticker: {
          sticker: { id: 3 },
          thumbnail: { file: { id: 4 } },
          format: { _: 'stickerFormatTgs' },
        },
      }),
    ).toEqual({
      sticker: { id: 3 },
      thumbnail: { id: 4 },
      animated: true,
      format: 'stickerFormatTgs',
    });

    expect(
      extractTelegramAnimationSource({
        _: 'messageAnimation',
        animation: { mime_type: 'video/mp4', animation: { id: 5 } },
      }),
    ).toEqual({
      file: { id: 5 },
      mimeType: 'video/mp4',
    });

    expect(
      extractTelegramVideoFile({
        _: 'messageVideoNote',
        video_note: { video: { id: 6 } },
      }),
    ).toEqual({ id: 6 });

    expect(
      extractTelegramVideoThumbnailFile({
        _: 'messageVideo',
        video: { video: { id: 6 }, thumbnail: { file: { id: 7 } } },
      }),
    ).toEqual({ id: 7 });

    expect(
      extractTelegramVideoThumbnailFile({
        _: 'messageVideoNote',
        video_note: { video: { id: 8 }, thumbnail: { file: { id: 9 } } },
      }),
    ).toEqual({ id: 9 });

    expect(
      extractTelegramVideoDimensions({
        _: 'messageVideo',
        video: { width: 720, height: 1280 },
      }),
    ).toEqual({ width: 720, height: 1280 });

    expect(extractTelegramVideoDimensions({ _: 'messageVideoNote' })).toEqual({
      width: 1,
      height: 1,
    });

    expect(
      extractTelegramVoiceNoteFile({
        _: 'messageVoiceNote',
        voice_note: { voice: { id: 9 }, duration: 14 },
      }),
    ).toEqual({ id: 9 });
  });

  it('derives media flags, mime types, and sticker metadata', () => {
    expect(hasTelegramVideo({ _: 'messageVideo' })).toBe(true);
    expect(hasTelegramVoiceNote({ _: 'messageVoiceNote' })).toBe(true);
    expect(extractTelegramVoiceDurationSeconds({ _: 'messageVoiceNote', voice_note: { duration: 9.8 } })).toBe(9);
    expect(
      extractTelegramAnimationMimeType({
        _: 'messageAnimation',
        animation: { mime_type: ' image/gif ' },
      }),
    ).toBe('image/gif');
    expect(
      extractTelegramVideoMimeType({
        _: 'messageVideoNote',
        video_note: {},
      }),
    ).toBe('video/mp4');
    expect(
      extractTelegramStickerEmoji({
        _: 'messageSticker',
        emoji: '  😀 ',
      }),
    ).toBe('😀');
    expect(
      isTelegramAnimatedSticker({
        _: 'messageSticker',
        sticker: { format: { _: 'stickerFormatWebm' } },
      }),
    ).toBe(true);
  });

  it('builds local media urls and infers mime types from paths', () => {
    expect(buildTelegramLocalMediaUrl('/tmp/clip.mp4')).toBe(
      'pelec-media://local/?path=%2Ftmp%2Fclip.mp4',
    );
    expect(inferTelegramLocalMimeType('/tmp/photo.webp')).toBe('image/webp');
    expect(inferTelegramLocalMimeType('/tmp/audio.ogg')).toBe('audio/ogg;codecs=opus');
    expect(inferTelegramLocalMimeType('/tmp/video.mp4')).toBe('video/mp4');
    expect(inferTelegramLocalMimeType('/tmp/video.webm')).toBe('video/webm');
    expect(inferTelegramLocalMimeType('/tmp/video.mov')).toBe('video/quicktime');
    expect(inferTelegramLocalMimeType('/tmp/file.bin', 'application/pdf')).toBe('application/pdf');
  });

  it('maps Telegram stickers and animations into picker items', () => {
    const sticker = {
      emoji: ' 😀 ',
      width: 512,
      height: 512,
      sticker: { id: 11 },
      thumbnail: { file: { id: 12 } },
      format: { _: 'stickerFormatWebm' },
    };
    const animation = {
      width: 320,
      height: 240,
      animation: { id: 21 },
      thumbnail: { file: { id: 22 } },
      mime_type: 'video/mp4',
    };

    expect(getTelegramStickerPreviewFile(sticker)).toEqual({ id: 11 });
    expect(getTelegramAnimationPreviewFile(animation)).toEqual({ id: 22 });
    expect(
      mapTelegramStickerToPickerItem(
        sticker,
        'pelec-media://local/?path=sticker.webm',
        'video/webm',
        'Set',
      ),
    ).toEqual({
      id: '11',
      kind: 'sticker',
      previewUrl: 'pelec-media://local/?path=sticker.webm',
      previewMimeType: 'video/webm',
      emoji: '😀',
      setTitle: 'Set',
      animated: true,
      width: 512,
      height: 512,
    });
    expect(
      mapTelegramAnimationToPickerItem(
        animation,
        'pelec-media://local/?path=gif.mp4',
        'video/mp4',
      ),
    ).toEqual({
      id: '21',
      kind: 'gif',
      previewUrl: 'pelec-media://local/?path=gif.mp4',
      previewMimeType: 'video/mp4',
      animated: true,
      width: 320,
      height: 240,
    });
    expect(mapTelegramStickerToPickerItem({ sticker: {} }, 'preview')).toBeUndefined();
    expect(mapTelegramAnimationToPickerItem({ animation: { id: 9 } }, undefined)).toBeUndefined();
  });
});
