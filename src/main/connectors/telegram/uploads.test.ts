import { describe, expect, it } from 'vitest';
import {
  extensionFromMime,
  isSupportedVoiceNoteMimeType,
  parseDataUrl,
  resolveUploadFileName,
  sanitizeUploadFileName,
} from './uploads';

describe('telegram upload helpers', () => {
  it('parses valid base64 data urls', () => {
    const parsed = parseDataUrl('data:text/plain;base64,SGVsbG8=');

    expect(parsed?.fullMimeType).toBe('text/plain');
    expect(parsed?.essenceMimeType).toBe('text/plain');
    expect(parsed?.bytes.toString('utf8')).toBe('Hello');
  });

  it('rejects malformed data urls', () => {
    expect(parseDataUrl('https://example.com/file')).toBeUndefined();
    expect(parseDataUrl('data:text/plain,plain')).toBeUndefined();
  });

  it('normalizes upload file names and inferred extensions', () => {
    expect(sanitizeUploadFileName(' ../bad:name?.png ')).toBe('bad_name_.png');
    expect(resolveUploadFileName('voice-note', 'audio/ogg;codecs=opus', 'fallback')).toBe(
      'voice-note.ogg',
    );
    expect(extensionFromMime('image/jpeg')).toBe('.jpg');
  });

  it('detects supported Telegram voice-note mime types', () => {
    expect(isSupportedVoiceNoteMimeType('audio/webm;codecs=opus')).toBe(true);
    expect(isSupportedVoiceNoteMimeType('audio/mpeg')).toBe(false);
  });
});
