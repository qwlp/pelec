import { describe, expect, it } from 'vitest';
import {
  buildTelegramLocalMediaUrl,
  extractTelegramAnimationMimeType,
  extractTelegramAnimationSource,
  extractTelegramDocumentMetadata,
  extractTelegramImageDocumentSource,
  extractTelegramPhotoFiles,
  extractTelegramStickerEmoji,
  extractTelegramStickerSource,
  extractTelegramVideoFile,
  extractTelegramVideoMimeType,
  extractTelegramVoiceDurationSeconds,
  extractTelegramVoiceNoteFile,
  getTelegramDocument,
  hasTelegramVideo,
  hasTelegramVoiceNote,
  inferTelegramLocalMimeType,
  isTelegramAnimatedSticker,
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
    expect(inferTelegramLocalMimeType('/tmp/file.bin', 'application/pdf')).toBe('application/pdf');
  });
});
