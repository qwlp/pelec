import { describe, expect, it } from 'vitest';
import {
  buildVoiceBarHeights,
  extractLocalMediaPath,
  formatTelegramAttachmentMeta,
  formatTelegramDocumentSubtitle,
  getTelegramAttachmentKind,
  getTelegramMeaningfulAlbumCaption,
  isTelegramAlbumEligibleMessage,
  isTelegramDocumentFallbackText,
  isTelegramImageFallbackText,
  isTelegramVideoFallbackText,
} from './media';

describe('telegram media helpers', () => {
  it('classifies attachment kinds from mime type', () => {
    expect(getTelegramAttachmentKind('image/png')).toBe('image');
    expect(getTelegramAttachmentKind('audio/ogg;codecs=opus')).toBe('voice');
    expect(getTelegramAttachmentKind('application/pdf')).toBe('document');
  });

  it('formats attachment metadata and document subtitles', () => {
    expect(
      formatTelegramAttachmentMeta({
        id: '1',
        kind: 'voice',
        name: 'voice-note.ogg',
        sizeBytes: 1536,
        dataUrl: 'data:audio/ogg;base64,abc',
      }),
    ).toBe('Voice note • 1.5 KB');
    expect(formatTelegramDocumentSubtitle('report.pdf')).toBe('PDF');
  });

  it('detects Telegram fallback text variants', () => {
    expect(
      isTelegramDocumentFallbackText({
        id: '1',
        sender: 'A',
        text: 'Document: Invoice.pdf',
        timestamp: 0,
        document: { fileName: 'Invoice.pdf' },
      }),
    ).toBe(true);
    expect(
      isTelegramImageFallbackText({
        id: '2',
        sender: 'A',
        text: 'photo',
        timestamp: 0,
        imageUrl: 'image://1',
      }),
    ).toBe(true);
    expect(
      isTelegramVideoFallbackText({
        id: '3',
        sender: 'A',
        text: '[video]',
        timestamp: 0,
        hasVideo: true,
      }),
    ).toBe(true);
  });

  it('keeps album captions only when they add real text', () => {
    const albumMessage = {
      id: '4',
      sender: 'A',
      text: 'Trip update',
      timestamp: 0,
      mediaAlbumId: 'album-1',
      imageUrl: 'image://1',
    };

    expect(isTelegramAlbumEligibleMessage(albumMessage)).toBe(true);
    expect(getTelegramMeaningfulAlbumCaption(albumMessage)).toBe('Trip update');
    expect(
      getTelegramMeaningfulAlbumCaption({
        ...albumMessage,
        text: 'photo',
      }),
    ).toBeUndefined();
  });

  it('extracts local protocol paths and builds deterministic voice bars', () => {
    expect(extractLocalMediaPath('pelec-media://video?path=%2Ftmp%2Fclip.mp4')).toBe(
      '/tmp/clip.mp4',
    );
    expect(buildVoiceBarHeights('seed-1', 4)).toEqual(buildVoiceBarHeights('seed-1', 4));
    expect(buildVoiceBarHeights('seed-1', 4)).not.toEqual(buildVoiceBarHeights('seed-2', 4));
  });
});
