import { describe, expect, it } from 'vitest';
import {
  buildTelegramEmojiSuggestions,
  getTelegramEmojiTokenMatch,
} from './emoji';

describe('getTelegramEmojiTokenMatch', () => {
  it('detects the active emoji token at the cursor', () => {
    expect(getTelegramEmojiTokenMatch('hello :smi', 10, 10)).toEqual({
      query: 'smi',
      tokenStart: 6,
      tokenEnd: 10,
    });
  });

  it('detects a completed emoji alias token at the cursor', () => {
    expect(getTelegramEmojiTokenMatch(':sob:', 5, 5)).toEqual({
      query: 'sob',
      tokenStart: 0,
      tokenEnd: 5,
    });
  });

  it('ignores invalid inline tokens', () => {
    expect(getTelegramEmojiTokenMatch('hello:a', 7, 7)).toBeNull();
  });
});

describe('buildTelegramEmojiSuggestions', () => {
  it('returns canonical suggestions in priority order', () => {
    const suggestions = buildTelegramEmojiSuggestions('smi');
    expect(suggestions[0]).toEqual({
      emoji: '😄',
      canonicalAlias: 'smile',
      matchedAlias: 'smile',
    });
    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalAlias: 'smiling_face_with_tear',
        }),
      ]),
    );
  });

  it('matches compact aliases without requiring separator characters', () => {
    expect(buildTelegramEmojiSuggestions('smilingfacewithtear')[0]).toEqual({
      emoji: '🥲',
      canonicalAlias: 'smiling_face_with_tear',
      matchedAlias: 'smiling_face_with_tear',
    });
  });
});
