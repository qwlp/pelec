export type TelegramEmojiSuggestion = {
  emoji: string;
  canonicalAlias: string;
  matchedAlias: string;
};

export type TelegramEmojiTokenMatch = {
  query: string;
  tokenStart: number;
  tokenEnd: number;
};

type TelegramEmojiCatalogEntry = {
  emoji: string;
  aliases: string[];
};

type TelegramEmojiAliasEntry = {
  emoji: string;
  alias: string;
  canonicalAlias: string;
};

const TELEGRAM_EMOJI_COMPLETION_MAX_RESULTS = 7;
const TELEGRAM_EMOJI_ALIAS_MAX_LENGTH = 32;
const TELEGRAM_EMOJI_ALIAS_PATTERN = /^[a-z0-9_+-]+$/i;
const TELEGRAM_EMOJI_CATALOG: TelegramEmojiCatalogEntry[] = [
  { emoji: '😄', aliases: ['smile', 'happy', 'smiley'] },
  { emoji: '😀', aliases: ['grinning', 'grin'] },
  { emoji: '😂', aliases: ['joy', 'laugh', 'laughing'] },
  { emoji: '🤣', aliases: ['rofl', 'rolling_on_the_floor_laughing'] },
  { emoji: '🙂', aliases: ['slight_smile', 'slightly_smiling_face'] },
  { emoji: '😊', aliases: ['blush', 'shy'] },
  { emoji: '😉', aliases: ['wink'] },
  { emoji: '😍', aliases: ['heart_eyes', 'love_eyes'] },
  { emoji: '😘', aliases: ['kissing_heart', 'kiss'] },
  { emoji: '😋', aliases: ['yum', 'tongue'] },
  { emoji: '😎', aliases: ['sunglasses', 'cool'] },
  { emoji: '🤔', aliases: ['thinking', 'think'] },
  { emoji: '😐', aliases: ['neutral_face', 'meh'] },
  { emoji: '🙄', aliases: ['roll_eyes', 'eyeroll'] },
  { emoji: '😴', aliases: ['sleeping', 'sleep'] },
  { emoji: '😪', aliases: ['sleepy_face'] },
  { emoji: '😩', aliases: ['weary', 'exhausted'] },
  { emoji: '🥺', aliases: ['pleading_face', 'please'] },
  { emoji: '😢', aliases: ['cry', 'sad', 'crying'] },
  { emoji: '😭', aliases: ['sob', 'sobbing', 'tears'] },
  { emoji: '😡', aliases: ['rage', 'angry', 'mad'] },
  { emoji: '😱', aliases: ['scream', 'shocked'] },
  { emoji: '😳', aliases: ['flushed', 'embarrassed'] },
  { emoji: '🤯', aliases: ['mind_blown', 'exploding_head'] },
  { emoji: '😇', aliases: ['innocent', 'angel'] },
  { emoji: '🥳', aliases: ['partying_face', 'party'] },
  { emoji: '🤡', aliases: ['clown_face', 'clown'] },
  { emoji: '💩', aliases: ['poop', 'shit'] },
  { emoji: '👋', aliases: ['wave', 'hello', 'hi'] },
  { emoji: '🙌', aliases: ['raised_hands', 'celebrate'] },
  { emoji: '👏', aliases: ['clap', 'applause'] },
  { emoji: '🙏', aliases: ['pray', 'thanks', 'thank_you'] },
  { emoji: '💪', aliases: ['muscle', 'strong'] },
  { emoji: '👍', aliases: ['thumbsup', 'thumbs_up', 'yes', 'like'] },
  { emoji: '👎', aliases: ['thumbsdown', 'thumbs_down', 'dislike', 'no'] },
  { emoji: '👌', aliases: ['ok_hand', 'ok'] },
  { emoji: '✌️', aliases: ['v', 'victory_hand', 'peace'] },
  { emoji: '🤝', aliases: ['handshake', 'deal'] },
  { emoji: '❤️', aliases: ['heart', 'love'] },
  { emoji: '🧡', aliases: ['orange_heart'] },
  { emoji: '💛', aliases: ['yellow_heart'] },
  { emoji: '💚', aliases: ['green_heart'] },
  { emoji: '💙', aliases: ['blue_heart'] },
  { emoji: '💜', aliases: ['purple_heart'] },
  { emoji: '🖤', aliases: ['black_heart'] },
  { emoji: '🤍', aliases: ['white_heart'] },
  { emoji: '🤎', aliases: ['brown_heart'] },
  { emoji: '💔', aliases: ['broken_heart', 'heartbreak'] },
  { emoji: '🔥', aliases: ['fire', 'lit'] },
  { emoji: '✨', aliases: ['sparkles', 'sparkle'] },
  { emoji: '⭐', aliases: ['star'] },
  { emoji: '🌟', aliases: ['glowing_star'] },
  { emoji: '🎉', aliases: ['tada', 'party_popper', 'celebration'] },
  { emoji: '🎊', aliases: ['confetti_ball', 'confetti'] },
  { emoji: '🚀', aliases: ['rocket'] },
  { emoji: '☕', aliases: ['coffee'] },
  { emoji: '✅', aliases: ['white_check_mark', 'check', 'done'] },
  { emoji: '❌', aliases: ['x', 'cross_mark'] },
  { emoji: '💯', aliases: ['100', 'hundred'] },
  { emoji: '👀', aliases: ['eyes', 'look'] },
  { emoji: '🤷', aliases: ['shrug', 'idk'] },
  { emoji: '🤦', aliases: ['facepalm'] },
  { emoji: '😅', aliases: ['sweat_smile', 'phew'] },
  { emoji: '🥲', aliases: ['smiling_face_with_tear', 'bittersweet'] },
  { emoji: '😬', aliases: ['grimacing', 'awkward'] },
  { emoji: '😌', aliases: ['relieved', 'calm'] },
];

const TELEGRAM_EMOJI_INDEX: TelegramEmojiAliasEntry[] = [];
for (const entry of TELEGRAM_EMOJI_CATALOG) {
  const canonicalAlias = entry.aliases[0];
  if (!canonicalAlias) {
    continue;
  }
  for (const alias of entry.aliases) {
    TELEGRAM_EMOJI_INDEX.push({
      emoji: entry.emoji,
      alias,
      canonicalAlias,
    });
  }
}

TELEGRAM_EMOJI_INDEX.sort(
  (left, right) =>
    left.alias.localeCompare(right.alias) ||
    left.canonicalAlias.localeCompare(right.canonicalAlias),
);

export const getTelegramEmojiTokenMatch = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): TelegramEmojiTokenMatch | null => {
  if (
    selectionStart === null ||
    selectionEnd === null ||
    selectionStart !== selectionEnd
  ) {
    return null;
  }

  let tokenStart = selectionStart;
  while (tokenStart > 0 && !/\s/.test(value[tokenStart - 1])) {
    tokenStart -= 1;
  }

  let tokenEnd = selectionStart;
  while (tokenEnd < value.length && !/\s/.test(value[tokenEnd])) {
    tokenEnd += 1;
  }

  const token = value.slice(tokenStart, tokenEnd);
  if (!token.startsWith(':')) {
    return null;
  }

  const previousChar = tokenStart > 0 ? value[tokenStart - 1] : '';
  if (previousChar && /[a-z0-9_]/i.test(previousChar)) {
    return null;
  }

  const query = value.slice(tokenStart + 1, selectionStart).toLowerCase();
  const suffix = value.slice(selectionStart, tokenEnd);
  if (
    query.length < 1 ||
    query.length > TELEGRAM_EMOJI_ALIAS_MAX_LENGTH ||
    !TELEGRAM_EMOJI_ALIAS_PATTERN.test(query)
  ) {
    return null;
  }

  if (suffix && !TELEGRAM_EMOJI_ALIAS_PATTERN.test(suffix)) {
    return null;
  }

  return {
    query,
    tokenStart,
    tokenEnd,
  };
};

export const buildTelegramEmojiSuggestions = (query: string): TelegramEmojiSuggestion[] => {
  if (!query) {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const matches = TELEGRAM_EMOJI_INDEX.filter((entry) =>
    entry.alias.startsWith(normalizedQuery),
  );
  matches.sort((left, right) => {
    const leftPriority =
      left.alias === normalizedQuery ? 0 : left.canonicalAlias === normalizedQuery ? 1 : 2;
    const rightPriority =
      right.alias === normalizedQuery ? 0 : right.canonicalAlias === normalizedQuery ? 1 : 2;
    return (
      leftPriority - rightPriority ||
      left.alias.length - right.alias.length ||
      left.canonicalAlias.length - right.canonicalAlias.length ||
      left.canonicalAlias.localeCompare(right.canonicalAlias)
    );
  });

  const suggestions: TelegramEmojiSuggestion[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const key = `${match.emoji}:${match.canonicalAlias}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    suggestions.push({
      emoji: match.emoji,
      canonicalAlias: match.canonicalAlias,
      matchedAlias: match.alias,
    });
    if (suggestions.length >= TELEGRAM_EMOJI_COMPLETION_MAX_RESULTS) {
      break;
    }
  }

  return suggestions;
};
