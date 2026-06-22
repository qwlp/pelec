import { createPortal } from 'react-dom';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import type { AppMode } from '../../../shared/types';
import type { PendingTelegramAttachment } from './media';
import type { LegacyAppBridgeApi, LegacyTelegramReplyPreview } from '../../legacyBridge';
import {
  buildTelegramEmojiSuggestions,
  getTelegramEmojiTokenMatch,
  type TelegramEmojiSuggestion,
} from '../../lib/emoji';
import { formatTelegramAttachmentMeta } from './media';

interface TelegramComposerProps {
  appMode?: AppMode;
  attachments: PendingTelegramAttachment[];
  canSend: boolean;
  draftText: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  legacyApi: LegacyAppBridgeApi | null;
  mentionSuggestions?: TelegramMentionSuggestion[];
  onModeChange?: (mode: AppMode) => void;
  replyPreview: LegacyTelegramReplyPreview | null;
  sendBehavior: 'enter' | 'mod-enter';
  target: HTMLElement | null;
  voiceRecorderState: 'idle' | 'preparing' | 'recording' | 'sending' | 'unsupported';
}

export interface TelegramMentionSuggestion {
  displayName: string;
  mention: string;
  username?: string;
}

type TelegramEmojiCompletionState = {
  activeIndex: number;
  suggestions: TelegramEmojiSuggestion[];
  tokenEnd: number;
  tokenStart: number;
};

type TelegramMentionCompletionState = {
  activeIndex: number;
  suggestions: TelegramMentionSuggestion[];
  tokenEnd: number;
  tokenStart: number;
};

type TelegramVimMode = 'insert' | 'normal' | 'visual' | 'visual-block' | 'visual-line';
type TelegramVimSequence = 'c' | 'ca' | 'ci' | 'd' | 'da' | 'di' | 'g' | null;

const TELEGRAM_COMPOSER_MIN_HEIGHT_PX = 48;
const TELEGRAM_COMPOSER_MAX_HEIGHT_PX = 160;
const TELEGRAM_TEXT_MESSAGE_LIMIT = 4096;
const TELEGRAM_MEDIA_CAPTION_LIMIT = 1024;
const TELEGRAM_VIM_SEQUENCE_TIMEOUT_MS = 900;

const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u;
const HORIZONTAL_WHITESPACE_PATTERN = /[^\S\n]/u;

const getTelegramCharacterCount = (value: string): number => Array.from(value).length;

const clampIndex = (index: number, value: string): number => Math.max(0, Math.min(value.length, index));

const getLineStart = (value: string, index: number): number => {
  const cursor = clampIndex(index, value);
  return value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
};

const getLineEnd = (value: string, index: number): number => {
  const cursor = clampIndex(index, value);
  const newlineIndex = value.indexOf('\n', cursor);
  return newlineIndex === -1 ? value.length : newlineIndex;
};

const getLineSelectionRange = (
  value: string,
  anchorIndex: number,
  activeIndex: number,
): { end: number; start: number } => {
  const anchor = getLineColumnAtIndex(value, anchorIndex);
  const active = getLineColumnAtIndex(value, activeIndex);
  const startLine = Math.min(anchor.line, active.line);
  const endLine = Math.max(anchor.line, active.line);
  const start = getLineStartByNumber(value, startLine);
  const endLineStart = getLineStartByNumber(value, endLine);
  const lineEnd = getLineEnd(value, endLineStart);
  const end = lineEnd < value.length ? lineEnd + 1 : lineEnd;

  return { start, end };
};

const getLineColumnAtIndex = (value: string, index: number): { column: number; line: number } => {
  const cursor = clampIndex(index, value);
  let line = 0;
  let lineStart = 0;

  for (let i = 0; i < cursor; i += 1) {
    if (value[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }

  return {
    column: cursor - lineStart,
    line,
  };
};

const getLineStartByNumber = (value: string, targetLine: number): number => {
  if (targetLine <= 0) {
    return 0;
  }

  let line = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\n') {
      line += 1;
      if (line === targetLine) {
        return i + 1;
      }
    }
  }

  return value.length;
};

const getLineCount = (value: string): number => value.split('\n').length;

const getIndexAtLineColumn = (value: string, line: number, column: number): number => {
  const clampedLine = Math.max(0, Math.min(getLineCount(value) - 1, line));
  const lineStart = getLineStartByNumber(value, clampedLine);
  const lineEnd = getLineEnd(value, lineStart);
  return Math.min(lineEnd, lineStart + Math.max(0, column));
};

const getFirstNonWhitespaceInLine = (value: string, index: number): number => {
  const lineStart = getLineStart(value, index);
  const lineEnd = getLineEnd(value, index);
  const match = /\S/u.exec(value.slice(lineStart, lineEnd));
  return match ? lineStart + match.index : lineStart;
};

const moveCursorVertically = (value: string, index: number, direction: -1 | 1): number => {
  const cursor = clampIndex(index, value);
  const currentLineStart = getLineStart(value, cursor);
  const column = cursor - currentLineStart;

  if (direction < 0) {
    if (currentLineStart === 0) {
      return cursor;
    }

    const previousLineEnd = currentLineStart - 1;
    const previousLineStart = getLineStart(value, previousLineEnd);
    return Math.min(previousLineStart + column, previousLineEnd);
  }

  const currentLineEnd = getLineEnd(value, cursor);
  if (currentLineEnd >= value.length) {
    return cursor;
  }

  const nextLineStart = currentLineEnd + 1;
  const nextLineEnd = getLineEnd(value, nextLineStart);
  return Math.min(nextLineStart + column, nextLineEnd);
};

const findNextWordStart = (value: string, index: number): number => {
  let cursor = clampIndex(index, value);

  if (WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
    while (cursor < value.length && WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
      cursor += 1;
    }
  }

  while (cursor < value.length && !WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
    cursor += 1;
  }

  return cursor;
};

const findPreviousWordStart = (value: string, index: number): number => {
  let cursor = clampIndex(index, value) - 1;

  while (cursor > 0 && !WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
    cursor -= 1;
  }

  while (cursor > 0 && WORD_CHARACTER_PATTERN.test(value[cursor - 1] ?? '')) {
    cursor -= 1;
  }

  return Math.max(0, cursor);
};

const findWordEnd = (value: string, index: number): number => {
  let cursor = clampIndex(index, value);

  if (!WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
    while (cursor < value.length && !WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
      cursor += 1;
    }
  } else if (WORD_CHARACTER_PATTERN.test(value[cursor + 1] ?? '')) {
    cursor += 1;
  }

  while (cursor < value.length - 1 && WORD_CHARACTER_PATTERN.test(value[cursor + 1] ?? '')) {
    cursor += 1;
  }

  return cursor;
};

const getWordTextObject = (
  value: string,
  index: number,
  around: boolean,
): { end: number; start: number } | null => {
  if (value.length < 1) {
    return null;
  }

  let cursor = clampIndex(index, value);
  if (!WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
    if (cursor > 0 && WORD_CHARACTER_PATTERN.test(value[cursor - 1] ?? '')) {
      cursor -= 1;
    } else {
      while (cursor < value.length && !WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
        cursor += 1;
      }
    }
  }

  if (!WORD_CHARACTER_PATTERN.test(value[cursor] ?? '')) {
    return null;
  }

  let start = cursor;
  let end = cursor + 1;

  while (start > 0 && WORD_CHARACTER_PATTERN.test(value[start - 1] ?? '')) {
    start -= 1;
  }
  while (end < value.length && WORD_CHARACTER_PATTERN.test(value[end] ?? '')) {
    end += 1;
  }

  if (!around) {
    return { start, end };
  }

  let aroundEnd = end;
  while (aroundEnd < value.length && HORIZONTAL_WHITESPACE_PATTERN.test(value[aroundEnd] ?? '')) {
    aroundEnd += 1;
  }

  if (aroundEnd > end) {
    return { start, end: aroundEnd };
  }

  let aroundStart = start;
  while (
    aroundStart > 0 &&
    HORIZONTAL_WHITESPACE_PATTERN.test(value[aroundStart - 1] ?? '')
  ) {
    aroundStart -= 1;
  }

  return { start: aroundStart, end };
};

const getBlockTextObject = (
  value: string,
  anchorIndex: number,
  activeIndex: number,
): Array<{ end: number; start: number }> => {
  const anchor = getLineColumnAtIndex(value, anchorIndex);
  const active = getLineColumnAtIndex(value, activeIndex);
  const startLine = Math.min(anchor.line, active.line);
  const endLine = Math.max(anchor.line, active.line);
  const startColumn = Math.min(anchor.column, active.column);
  const endColumn = Math.max(anchor.column, active.column);
  const ranges: Array<{ end: number; start: number }> = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const start = getIndexAtLineColumn(value, line, startColumn);
    const end = getIndexAtLineColumn(value, line, endColumn + 1);
    if (end > start) {
      ranges.push({ start, end });
    }
  }

  return ranges;
};

const isPlainPrintableKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

const isTrustedInputEvent = (event: { nativeEvent: Event }): boolean =>
  event.nativeEvent.isTrusted !== false;

const getTelegramMentionTokenMatch = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): { query: string; tokenEnd: number; tokenStart: number } | null => {
  if (
    typeof selectionStart !== 'number' ||
    typeof selectionEnd !== 'number' ||
    selectionStart !== selectionEnd
  ) {
    return null;
  }

  const beforeCursor = value.slice(0, selectionStart);
  const match = /(^|\s)@([A-Za-z0-9_]*)$/u.exec(beforeCursor);
  if (!match) {
    return null;
  }

  const prefix = match[1] ?? '';
  const query = match[2] ?? '';
  const tokenStart = selectionStart - query.length - 1;
  const tokenEnd = selectionStart;

  if (prefix.length > 0 && value[tokenStart - 1] && !/\s/u.test(value[tokenStart - 1])) {
    return null;
  }

  return {
    query,
    tokenEnd,
    tokenStart,
  };
};

const getClipboardFiles = (clipboardData: DataTransfer | null): File[] => {
  if (!clipboardData) {
    return [];
  }

  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);

  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return Array.from(clipboardData.files ?? []);
};

const formatRecordingDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const TelegramComposer = ({
  appMode = 'insert',
  attachments,
  canSend,
  draftText,
  inputRef,
  legacyApi,
  mentionSuggestions = [],
  onModeChange,
  replyPreview,
  sendBehavior,
  target,
  voiceRecorderState,
}: TelegramComposerProps) => {
  const [value, setValue] = useState(draftText);
  const [composerMode, setComposerMode] = useState<TelegramVimMode>(
    appMode === 'insert' ? 'insert' : 'normal',
  );
  const [emojiCompletion, setEmojiCompletion] = useState<TelegramEmojiCompletionState | null>(null);
  const [mentionCompletion, setMentionCompletion] = useState<TelegramMentionCompletionState | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [dragDepth, setDragDepth] = useState(0);
  const [limitDialogMessage, setLimitDialogMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const syncedDraftValueRef = useRef(draftText);
  const hasLocalDraftEditRef = useRef(false);
  const pendingSelectionRef = useRef<{ end: number; start: number } | null>(null);
  const visualAnchorRef = useRef<number | null>(null);
  const visualBlockActiveRef = useRef<number | null>(null);
  const visualLineActiveRef = useRef<number | null>(null);
  const vimSequenceRef = useRef<{ key: TelegramVimSequence; timestamp: number }>({
    key: null,
    timestamp: 0,
  });

  const requestComposerMode = (mode: TelegramVimMode) => {
    vimSequenceRef.current = { key: null, timestamp: 0 };
    if (mode !== 'visual' && mode !== 'visual-block' && mode !== 'visual-line') {
      visualAnchorRef.current = null;
      visualBlockActiveRef.current = null;
      visualLineActiveRef.current = null;
    }
    setComposerMode(mode);
    if (mode === 'visual' || mode === 'visual-block' || mode === 'visual-line') {
      legacyApi?.setMode('normal');
      return;
    }
    if (onModeChange) {
      onModeChange(mode);
      return;
    }
    legacyApi?.setMode(mode);
  };

  const syncDraftValue = (nextValue: string) => {
    if (syncedDraftValueRef.current === nextValue) {
      return;
    }

    syncedDraftValueRef.current = nextValue;
    hasLocalDraftEditRef.current = true;
    setValue(nextValue);
    legacyApi?.setTelegramDraftValue(nextValue);
  };

  const syncDraftValueWithSelection = (
    nextValue: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ) => {
    const nextSelection = {
      start: clampIndex(selectionStart, nextValue),
      end: clampIndex(selectionEnd, nextValue),
    };
    pendingSelectionRef.current = nextSelection;
    syncDraftValue(nextValue);
  };

  const moveTextareaCursor = (nextSelectionStart: number, nextSelectionEnd = nextSelectionStart) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const start = clampIndex(nextSelectionStart, value);
    const end = clampIndex(nextSelectionEnd, value);
    textarea.setSelectionRange(start, end);
    updateMentionCompletion(value, start, end, true);
    updateEmojiCompletion(value, start, end);
  };

  const setVisualSelection = (anchor: number, active: number) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const clampedAnchor = clampIndex(anchor, value);
    const clampedActive = clampIndex(active, value);
    const start = Math.min(clampedAnchor, clampedActive);
    const end =
      clampedActive >= clampedAnchor
        ? Math.min(value.length, clampedActive + 1)
        : Math.min(value.length, clampedAnchor + 1);

    visualAnchorRef.current = clampedAnchor;
    textarea.setSelectionRange(start, Math.max(start, end));
  };

  const setVisualBlockSelection = (anchor: number, active: number) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const clampedAnchor = clampIndex(anchor, value);
    const clampedActive = clampIndex(active, value);
    const ranges = getBlockTextObject(value, clampedAnchor, clampedActive);

    visualAnchorRef.current = clampedAnchor;
    visualBlockActiveRef.current = clampedActive;
    if (ranges.length < 1) {
      textarea.setSelectionRange(clampedActive, clampedActive);
      return;
    }

    textarea.setSelectionRange(ranges[0].start, ranges[ranges.length - 1].end);
  };

  const setVisualLineSelection = (anchor: number, active: number) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const clampedAnchor = clampIndex(anchor, value);
    const clampedActive = clampIndex(active, value);
    const range = getLineSelectionRange(value, clampedAnchor, clampedActive);

    visualAnchorRef.current = clampedAnchor;
    visualLineActiveRef.current = clampedActive;
    textarea.setSelectionRange(range.start, range.end);
  };

  const getVisualActiveIndex = (textarea: HTMLTextAreaElement): number => {
    const anchor = visualAnchorRef.current ?? textarea.selectionStart ?? 0;
    if (textarea.selectionStart === textarea.selectionEnd) {
      return anchor;
    }

    return anchor <= textarea.selectionStart
      ? Math.max(textarea.selectionStart, textarea.selectionEnd - 1)
      : textarea.selectionStart;
  };

  const updateEmojiCompletion = (
    nextValue = value,
    selectionStart = textareaRef.current?.selectionStart ?? null,
    selectionEnd = textareaRef.current?.selectionEnd ?? null,
  ) => {
    if (document.activeElement !== textareaRef.current) {
      setEmojiCompletion(null);
      return;
    }

    if (getTelegramMentionTokenMatch(nextValue, selectionStart, selectionEnd)) {
      setEmojiCompletion(null);
      return;
    }

    const tokenMatch = getTelegramEmojiTokenMatch(nextValue, selectionStart, selectionEnd);
    if (!tokenMatch) {
      setEmojiCompletion(null);
      return;
    }

    const suggestions = buildTelegramEmojiSuggestions(tokenMatch.query);
    if (suggestions.length < 1) {
      setEmojiCompletion(null);
      return;
    }

    setEmojiCompletion((current) => {
      const currentSuggestion = current?.suggestions[current.activeIndex];
      let activeIndex = 0;

      if (currentSuggestion) {
        const matchedIndex = suggestions.findIndex(
          (suggestion) =>
            suggestion.canonicalAlias === currentSuggestion.canonicalAlias &&
            suggestion.matchedAlias === currentSuggestion.matchedAlias,
        );
        if (matchedIndex >= 0) {
          activeIndex = matchedIndex;
        }
      }

      return {
        activeIndex,
        suggestions,
        tokenEnd: tokenMatch.tokenEnd,
        tokenStart: tokenMatch.tokenStart,
      };
    });
  };

  const updateMentionCompletion = (
    nextValue = value,
    selectionStart = textareaRef.current?.selectionStart ?? null,
    selectionEnd = textareaRef.current?.selectionEnd ?? null,
    force = false,
  ) => {
    if (!force && document.activeElement !== textareaRef.current) {
      setMentionCompletion(null);
      return;
    }

    const tokenMatch = getTelegramMentionTokenMatch(nextValue, selectionStart, selectionEnd);
    if (!tokenMatch) {
      setMentionCompletion(null);
      return;
    }

    const query = tokenMatch.query.toLowerCase();
    const suggestions = mentionSuggestions
      .filter((suggestion) => {
        const displayName = suggestion.displayName.toLowerCase();
        const mention = suggestion.mention.toLowerCase();
        const username = suggestion.username?.toLowerCase() ?? '';
        return (
          query.length < 1 ||
          displayName.includes(query) ||
          mention.includes(query) ||
          username.includes(query)
        );
      })
      .slice(0, 8);

    if (suggestions.length < 1) {
      setMentionCompletion(null);
      return;
    }

    setEmojiCompletion(null);
    setMentionCompletion((current) => {
      const currentSuggestion = current?.suggestions[current.activeIndex];
      const matchedIndex = currentSuggestion
        ? suggestions.findIndex((suggestion) => suggestion.mention === currentSuggestion.mention)
        : -1;

      return {
        activeIndex: matchedIndex >= 0 ? matchedIndex : 0,
        suggestions,
        tokenEnd: tokenMatch.tokenEnd,
        tokenStart: tokenMatch.tokenStart,
      };
    });
  };

  const applyEmojiSuggestion = (suggestion?: TelegramEmojiSuggestion): boolean => {
    if (!emojiCompletion) {
      return false;
    }

    const activeSuggestion = suggestion ?? emojiCompletion.suggestions[emojiCompletion.activeIndex];
    if (!activeSuggestion) {
      setEmojiCompletion(null);
      return false;
    }

    const before = value.slice(0, emojiCompletion.tokenStart);
    const after = value.slice(emojiCompletion.tokenEnd);
    const nextValue = `${before}${activeSuggestion.emoji}${after}`;
    const nextSelection = before.length + activeSuggestion.emoji.length;

    pendingSelectionRef.current = {
      start: nextSelection,
      end: nextSelection,
    };
    syncDraftValue(nextValue);
    setEmojiCompletion(null);
    textareaRef.current?.focus();
    return true;
  };

  const applyMentionSuggestion = (suggestion?: TelegramMentionSuggestion): boolean => {
    if (!mentionCompletion) {
      return false;
    }

    const activeSuggestion =
      suggestion ?? mentionCompletion.suggestions[mentionCompletion.activeIndex];
    if (!activeSuggestion) {
      setMentionCompletion(null);
      return false;
    }

    const before = value.slice(0, mentionCompletion.tokenStart);
    const after = value.slice(mentionCompletion.tokenEnd);
    const suffix = after.startsWith(' ') || after.length === 0 ? '' : ' ';
    const nextValue = `${before}${activeSuggestion.mention}${suffix}${after}`;
    const nextSelection = before.length + activeSuggestion.mention.length + suffix.length;

    pendingSelectionRef.current = {
      start: nextSelection,
      end: nextSelection,
    };
    syncDraftValue(nextValue);
    setMentionCompletion(null);
    textareaRef.current?.focus();
    return true;
  };

  const handleSend = () => {
    if (!legacyApi) {
      return;
    }
    if (isOverTextLimit) {
      const limitMessage = nonVoiceAttachmentCount > 0
        ? `Telegram caption is ${characterCount.toLocaleString()} characters, above the ${activeTextLimit.toLocaleString()} character limit. Shorten it before sending.`
        : `Telegram message is ${characterCount.toLocaleString()} characters, above the ${activeTextLimit.toLocaleString()} character limit. Shorten it before sending.`;
      setLimitDialogMessage(limitMessage);
      return;
    }
    syncedDraftValueRef.current = '';
    hasLocalDraftEditRef.current = false;
    setValue('');
    legacyApi.sendTelegramMessage();
  };

  const deleteSelectionOrRange = (
    selectionStart: number,
    selectionEnd: number,
    fallbackEnd: number,
  ): number => {
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    const deleteEnd = end > start ? end : fallbackEnd;

    if (deleteEnd <= start) {
      return start;
    }

    const nextValue = `${value.slice(0, start)}${value.slice(deleteEnd)}`;
    syncDraftValueWithSelection(nextValue, start);
    return start;
  };

  const deleteCurrentLine = (enterInsertMode = false) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? 0;
    const lineStart = getLineStart(value, cursor);
    const lineEnd = getLineEnd(value, cursor);
    const deleteEnd = lineEnd < value.length ? lineEnd + 1 : lineEnd;
    const deleteStart = lineStart > 0 && deleteEnd === value.length ? lineStart - 1 : lineStart;
    const nextCursor = deleteStart === lineStart ? lineStart : deleteStart;
    const nextValue = `${value.slice(0, deleteStart)}${value.slice(deleteEnd)}`;

    syncDraftValueWithSelection(nextValue, nextCursor);
    if (enterInsertMode) {
      requestComposerMode('insert');
    }
  };

  const changeCurrentLine = () => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? 0;
    const lineStart = getLineStart(value, cursor);
    const lineEnd = getLineEnd(value, cursor);
    const nextValue = `${value.slice(0, lineStart)}${value.slice(lineEnd)}`;

    syncDraftValueWithSelection(nextValue, lineStart);
    requestComposerMode('insert');
  };

  const deleteCurrentSelection = (enterInsertMode = false): boolean => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      requestComposerMode(enterInsertMode ? 'insert' : 'normal');
      return false;
    }

    deleteSelectionOrRange(textarea.selectionStart, textarea.selectionEnd, textarea.selectionEnd);
    requestComposerMode(enterInsertMode ? 'insert' : 'normal');
    return true;
  };

  const deleteCurrentBlockSelection = (enterInsertMode = false): boolean => {
    const anchor = visualAnchorRef.current;
    const active = visualBlockActiveRef.current;
    if (anchor === null || active === null) {
      requestComposerMode(enterInsertMode ? 'insert' : 'normal');
      return false;
    }

    const ranges = getBlockTextObject(value, anchor, active);
    if (ranges.length < 1) {
      requestComposerMode(enterInsertMode ? 'insert' : 'normal');
      return false;
    }

    let nextValue = value;
    for (const range of [...ranges].reverse()) {
      nextValue = `${nextValue.slice(0, range.start)}${nextValue.slice(range.end)}`;
    }

    syncDraftValueWithSelection(nextValue, ranges[0].start);
    requestComposerMode(enterInsertMode ? 'insert' : 'normal');
    return true;
  };

  const applyWordTextObject = (
    operator: 'c' | 'd',
    around: boolean,
    selectionStart: number,
    selectionEnd: number,
  ): boolean => {
    const target = getWordTextObject(value, selectionStart, around);
    if (!target) {
      return false;
    }

    deleteSelectionOrRange(target.start, target.end, target.end);
    requestComposerMode(operator === 'c' ? 'insert' : 'normal');
    if (selectionStart !== selectionEnd) {
      textareaRef.current?.setSelectionRange(target.start, target.start);
    }
    return true;
  };

  const handleVisualModeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.altKey || (event.metaKey && event.key !== 'Enter')) {
      return false;
    }

    const textarea = event.currentTarget;
    const anchor = visualAnchorRef.current ?? textarea.selectionStart ?? 0;
    const active = getVisualActiveIndex(textarea);

    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    if (event.key === 'Escape') {
      const cursor = Math.min(textarea.selectionStart, textarea.selectionEnd);
      requestComposerMode('normal');
      textarea.setSelectionRange(cursor, cursor);
      return handled();
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      handleSend();
      return handled();
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'v') {
      requestComposerMode('visual-block');
      visualAnchorRef.current = anchor;
      setVisualBlockSelection(anchor, active);
      return handled();
    }

    if (event.ctrlKey) {
      return false;
    }

    switch (event.key) {
      case 'v':
        requestComposerMode('normal');
        textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
        return handled();
      case 'V':
        requestComposerMode('visual-line');
        visualAnchorRef.current = anchor;
        setVisualLineSelection(anchor, active);
        return handled();
      case 'h':
      case 'ArrowLeft':
        setVisualSelection(anchor, Math.max(0, active - 1));
        return handled();
      case 'l':
      case 'ArrowRight':
        setVisualSelection(anchor, Math.min(value.length, active + 1));
        return handled();
      case 'j':
      case 'ArrowDown':
        setVisualSelection(anchor, moveCursorVertically(value, active, 1));
        return handled();
      case 'k':
      case 'ArrowUp':
        setVisualSelection(anchor, moveCursorVertically(value, active, -1));
        return handled();
      case '0':
      case 'Home':
        setVisualSelection(anchor, getLineStart(value, active));
        return handled();
      case '^':
        setVisualSelection(anchor, getFirstNonWhitespaceInLine(value, active));
        return handled();
      case '$':
      case 'End':
        setVisualSelection(anchor, getLineEnd(value, active));
        return handled();
      case 'G':
        setVisualSelection(anchor, value.length);
        return handled();
      case 'w':
        setVisualSelection(anchor, findNextWordStart(value, active));
        return handled();
      case 'b':
        setVisualSelection(anchor, findPreviousWordStart(value, active));
        return handled();
      case 'e':
        setVisualSelection(anchor, findWordEnd(value, active));
        return handled();
      case 'x':
      case 'd':
      case 'Delete':
        deleteCurrentSelection(false);
        return handled();
      case 'c':
      case 's':
        deleteCurrentSelection(true);
        return handled();
      case 'i':
        requestComposerMode('insert');
        textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
        return handled();
      default:
        if (isPlainPrintableKey(event)) {
          return handled();
        }
        return false;
    }
  };

  const handleVisualBlockModeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.altKey || (event.metaKey && event.key !== 'Enter')) {
      return false;
    }

    const textarea = event.currentTarget;
    const anchor = visualAnchorRef.current ?? textarea.selectionStart ?? 0;
    const active = visualBlockActiveRef.current ?? anchor;

    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    if (event.key === 'Escape') {
      requestComposerMode('normal');
      textarea.setSelectionRange(active, active);
      return handled();
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      handleSend();
      return handled();
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'v') {
      requestComposerMode('normal');
      textarea.setSelectionRange(active, active);
      return handled();
    }

    if (event.ctrlKey) {
      return false;
    }

    const activePosition = getLineColumnAtIndex(value, active);

    switch (event.key) {
      case 'v':
        requestComposerMode('visual');
        visualAnchorRef.current = anchor;
        setVisualSelection(anchor, active);
        return handled();
      case 'V':
        requestComposerMode('visual-line');
        visualAnchorRef.current = anchor;
        setVisualLineSelection(anchor, active);
        return handled();
      case 'h':
      case 'ArrowLeft':
        setVisualBlockSelection(
          anchor,
          getIndexAtLineColumn(value, activePosition.line, activePosition.column - 1),
        );
        return handled();
      case 'l':
      case 'ArrowRight':
        setVisualBlockSelection(
          anchor,
          getIndexAtLineColumn(value, activePosition.line, activePosition.column + 1),
        );
        return handled();
      case 'j':
      case 'ArrowDown':
        setVisualBlockSelection(anchor, moveCursorVertically(value, active, 1));
        return handled();
      case 'k':
      case 'ArrowUp':
        setVisualBlockSelection(anchor, moveCursorVertically(value, active, -1));
        return handled();
      case '0':
      case 'Home':
        setVisualBlockSelection(anchor, getLineStart(value, active));
        return handled();
      case '^':
        setVisualBlockSelection(anchor, getFirstNonWhitespaceInLine(value, active));
        return handled();
      case '$':
      case 'End':
        setVisualBlockSelection(anchor, getLineEnd(value, active));
        return handled();
      case 'G':
        setVisualBlockSelection(anchor, value.length);
        return handled();
      case 'w':
        setVisualBlockSelection(anchor, findNextWordStart(value, active));
        return handled();
      case 'b':
        setVisualBlockSelection(anchor, findPreviousWordStart(value, active));
        return handled();
      case 'e':
        setVisualBlockSelection(anchor, findWordEnd(value, active));
        return handled();
      case 'x':
      case 'd':
      case 'Delete':
        deleteCurrentBlockSelection(false);
        return handled();
      case 'c':
      case 's':
        deleteCurrentBlockSelection(true);
        return handled();
      case 'i':
        requestComposerMode('insert');
        textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
        return handled();
      default:
        if (isPlainPrintableKey(event)) {
          return handled();
        }
        return false;
    }
  };

  const handleVisualLineModeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.altKey || (event.metaKey && event.key !== 'Enter')) {
      return false;
    }

    const textarea = event.currentTarget;
    const anchor = visualAnchorRef.current ?? textarea.selectionStart ?? 0;
    const active = visualLineActiveRef.current ?? anchor;

    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    if (event.key === 'Escape') {
      requestComposerMode('normal');
      textarea.setSelectionRange(getLineStart(value, active), getLineStart(value, active));
      return handled();
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      handleSend();
      return handled();
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'v') {
      requestComposerMode('visual-block');
      visualAnchorRef.current = anchor;
      setVisualBlockSelection(anchor, active);
      return handled();
    }

    if (event.ctrlKey) {
      return false;
    }

    switch (event.key) {
      case 'V':
        requestComposerMode('normal');
        textarea.setSelectionRange(getLineStart(value, active), getLineStart(value, active));
        return handled();
      case 'v':
        requestComposerMode('visual');
        visualAnchorRef.current = anchor;
        setVisualSelection(anchor, active);
        return handled();
      case 'j':
      case 'ArrowDown':
        setVisualLineSelection(anchor, moveCursorVertically(value, active, 1));
        return handled();
      case 'k':
      case 'ArrowUp':
        setVisualLineSelection(anchor, moveCursorVertically(value, active, -1));
        return handled();
      case 'G':
        setVisualLineSelection(anchor, value.length);
        return handled();
      case 'g':
        setVisualLineSelection(anchor, 0);
        return handled();
      case 'x':
      case 'd':
      case 'Delete':
        deleteCurrentSelection(false);
        return handled();
      case 'c':
      case 's':
        deleteCurrentSelection(true);
        return handled();
      case 'i':
        requestComposerMode('insert');
        textarea.setSelectionRange(textarea.selectionStart, textarea.selectionStart);
        return handled();
      default:
        if (isPlainPrintableKey(event)) {
          return handled();
        }
        return false;
    }
  };

  const handleNormalModeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.altKey || (event.metaKey && event.key !== 'Enter')) {
      return false;
    }

    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const hasSelection = selectionStart !== selectionEnd;
    const now = Date.now();
    const sequence =
      now - vimSequenceRef.current.timestamp <= TELEGRAM_VIM_SEQUENCE_TIMEOUT_MS
        ? vimSequenceRef.current.key
        : null;

    const clearSequence = () => {
      vimSequenceRef.current = { key: null, timestamp: 0 };
    };

    const setSequence = (key: TelegramVimSequence) => {
      vimSequenceRef.current = { key, timestamp: now };
    };

    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };

    if (event.key === 'Escape') {
      clearSequence();
      textarea.blur();
      return handled();
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      clearSequence();
      handleSend();
      return handled();
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'v') {
      clearSequence();
      visualAnchorRef.current = selectionStart;
      setVisualBlockSelection(selectionStart, selectionEnd > selectionStart ? selectionEnd - 1 : selectionStart);
      requestComposerMode('visual-block');
      return handled();
    }

    if (event.ctrlKey) {
      return false;
    }

    if (sequence === 'g' && event.key === 'g') {
      clearSequence();
      moveTextareaCursor(0);
      return handled();
    }

    if (sequence === 'd' && event.key === 'd') {
      clearSequence();
      deleteCurrentLine();
      return handled();
    }

    if ((sequence === 'd' || sequence === 'c') && event.key === 'i') {
      setSequence(sequence === 'd' ? 'di' : 'ci');
      return handled();
    }

    if ((sequence === 'd' || sequence === 'c') && event.key === 'a') {
      setSequence(sequence === 'd' ? 'da' : 'ca');
      return handled();
    }

    if ((sequence === 'di' || sequence === 'ci' || sequence === 'da' || sequence === 'ca') && event.key === 'w') {
      clearSequence();
      applyWordTextObject(sequence[0] as 'c' | 'd', sequence[1] === 'a', selectionStart, selectionEnd);
      return handled();
    }

    if (sequence === 'c' && event.key === 'c') {
      clearSequence();
      changeCurrentLine();
      return handled();
    }

    clearSequence();

    switch (event.key) {
      case 'i':
        requestComposerMode('insert');
        return handled();
      case 'v':
        visualAnchorRef.current = selectionStart;
        setVisualSelection(selectionStart, selectionEnd > selectionStart ? selectionEnd - 1 : selectionStart);
        requestComposerMode('visual');
        return handled();
      case 'V':
        visualAnchorRef.current = selectionStart;
        setVisualLineSelection(selectionStart, selectionEnd > selectionStart ? selectionEnd - 1 : selectionStart);
        requestComposerMode('visual-line');
        return handled();
      case 'I':
        moveTextareaCursor(getFirstNonWhitespaceInLine(value, selectionStart));
        requestComposerMode('insert');
        return handled();
      case 'a':
        moveTextareaCursor(Math.min(value.length, selectionEnd + 1));
        requestComposerMode('insert');
        return handled();
      case 'A':
        moveTextareaCursor(getLineEnd(value, selectionEnd));
        requestComposerMode('insert');
        return handled();
      case 'o': {
        const lineEnd = getLineEnd(value, selectionEnd);
        const insertAt = value.length === 0 ? 0 : lineEnd;
        const textToInsert = value.length === 0 ? '' : '\n';
        const nextValue = `${value.slice(0, insertAt)}${textToInsert}${value.slice(insertAt)}`;
        syncDraftValueWithSelection(nextValue, insertAt + textToInsert.length);
        requestComposerMode('insert');
        return handled();
      }
      case 'O': {
        const lineStart = getLineStart(value, selectionStart);
        const textToInsert = value.length === 0 ? '' : '\n';
        const nextValue = `${value.slice(0, lineStart)}${textToInsert}${value.slice(lineStart)}`;
        syncDraftValueWithSelection(nextValue, lineStart);
        requestComposerMode('insert');
        return handled();
      }
      case 'h':
      case 'ArrowLeft':
        moveTextareaCursor(Math.max(0, selectionStart - 1));
        return handled();
      case 'l':
      case 'ArrowRight':
        moveTextareaCursor(Math.min(value.length, selectionEnd + 1));
        return handled();
      case 'j':
      case 'ArrowDown':
        moveTextareaCursor(moveCursorVertically(value, selectionEnd, 1));
        return handled();
      case 'k':
      case 'ArrowUp':
        moveTextareaCursor(moveCursorVertically(value, selectionStart, -1));
        return handled();
      case '0':
      case 'Home':
        moveTextareaCursor(getLineStart(value, selectionStart));
        return handled();
      case '^':
        moveTextareaCursor(getFirstNonWhitespaceInLine(value, selectionStart));
        return handled();
      case '$':
      case 'End':
        moveTextareaCursor(getLineEnd(value, selectionEnd));
        return handled();
      case 'G':
        moveTextareaCursor(value.length);
        return handled();
      case 'w':
        moveTextareaCursor(findNextWordStart(value, selectionEnd));
        return handled();
      case 'b':
        moveTextareaCursor(findPreviousWordStart(value, selectionStart));
        return handled();
      case 'e':
        moveTextareaCursor(findWordEnd(value, selectionEnd));
        return handled();
      case 'x':
      case 'Delete':
        deleteSelectionOrRange(selectionStart, selectionEnd, Math.min(value.length, selectionStart + 1));
        return handled();
      case 'X':
      case 'Backspace':
        if (hasSelection) {
          deleteSelectionOrRange(selectionStart, selectionEnd, selectionEnd);
        } else {
          deleteSelectionOrRange(Math.max(0, selectionStart - 1), selectionStart, selectionStart);
        }
        return handled();
      case 'D':
        deleteSelectionOrRange(selectionStart, selectionEnd, getLineEnd(value, selectionEnd));
        return handled();
      case 'C':
        deleteSelectionOrRange(selectionStart, selectionEnd, getLineEnd(value, selectionEnd));
        requestComposerMode('insert');
        return handled();
      case 'd':
        setSequence('d');
        return handled();
      case 'c':
        setSequence('c');
        return handled();
      case 'g':
        setSequence('g');
        return handled();
      default:
        if (isPlainPrintableKey(event)) {
          return handled();
        }
        return false;
    }
  };

  useEffect(() => {
    if (draftText === syncedDraftValueRef.current) {
      hasLocalDraftEditRef.current = false;
      return;
    }

    if (hasLocalDraftEditRef.current) {
      return;
    }

    syncedDraftValueRef.current = draftText;
    setValue(draftText);
  }, [draftText]);

  useEffect(() => {
    setComposerMode(appMode === 'insert' ? 'insert' : 'normal');
  }, [appMode]);

  useEffect(() => {
    if (composerMode === 'insert') {
      return;
    }

    setEmojiCompletion(null);
    setMentionCompletion(null);
  }, [composerMode]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = `${TELEGRAM_COMPOSER_MIN_HEIGHT_PX}px`;
    const nextHeight =
      value.length > 0
        ? Math.min(
            TELEGRAM_COMPOSER_MAX_HEIGHT_PX,
            Math.max(TELEGRAM_COMPOSER_MIN_HEIGHT_PX, textarea.scrollHeight),
          )
        : TELEGRAM_COMPOSER_MIN_HEIGHT_PX;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > TELEGRAM_COMPOSER_MAX_HEIGHT_PX ? 'auto' : 'hidden';
    if (pendingSelectionRef.current) {
      textarea.setSelectionRange(
        pendingSelectionRef.current.start,
        pendingSelectionRef.current.end,
      );
      pendingSelectionRef.current = null;
    }
  }, [value, attachments.length, replyPreview]);

  useEffect(() => {
    updateEmojiCompletion();
  }, [value]);

  useEffect(() => {
    if (voiceRecorderState === 'recording') {
      setRecordingStartedAt((current) => current ?? Date.now());
      return;
    }

    setRecordingStartedAt(null);
    setRecordingElapsedMs(0);
  }, [voiceRecorderState]);

  useEffect(() => {
    if (recordingStartedAt === null) {
      return;
    }

    setRecordingElapsedMs(Date.now() - recordingStartedAt);
    const timer = window.setInterval(() => {
      setRecordingElapsedMs(Date.now() - recordingStartedAt);
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [recordingStartedAt]);

  useEffect(() => {
    if (!limitDialogMessage) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLimitDialogMessage(null);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [limitDialogMessage]);

  const placeholder = useMemo(() => {
    if (replyPreview) {
      return `Reply to ${replyPreview.sender}`;
    }
    if (attachments.length > 0) {
      return 'Type a caption...';
    }
    return 'Type your message here...';
  }, [attachments.length, replyPreview]);

  const isRecording = voiceRecorderState === 'recording';
  const isPreparing = voiceRecorderState === 'preparing';
  const isSending = voiceRecorderState === 'sending';
  const composeLocked = isRecording || isPreparing || isSending;
  const dragActive = dragDepth > 0 && !composeLocked;
  const hasDraggedFiles = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) {
      return false;
    }

    if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')) {
      return true;
    }

    return Array.from(dataTransfer.files ?? []).length > 0;
  };
  const voiceStatus = useMemo(() => {
    if (isRecording) {
      return `Recording ${formatRecordingDuration(recordingElapsedMs)}`;
    }
    if (isPreparing) {
      return 'Preparing microphone...';
    }
    if (isSending) {
      return 'Sending voice note...';
    }
    if (voiceRecorderState === 'unsupported') {
      return 'Voice notes are unavailable in this build.';
    }
    return null;
  }, [isPreparing, isRecording, isSending, recordingElapsedMs, voiceRecorderState]);
  const nonVoiceAttachmentCount = attachments.filter((attachment) => attachment.kind !== 'voice').length;
  const activeTextLimit = nonVoiceAttachmentCount > 0
    ? TELEGRAM_MEDIA_CAPTION_LIMIT
    : TELEGRAM_TEXT_MESSAGE_LIMIT;
  const characterCount = getTelegramCharacterCount(value.trim());
  const isOverTextLimit = characterCount > activeTextLimit;

  if (!target || !canSend) {
    return null;
  }

  return createPortal(
    <div
      className={`telegram-composer-react-shell${dragActive ? ' drag-active' : ''}`}
      onDragEnter={(event) => {
        if (composeLocked || !hasDraggedFiles(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        if (composeLocked || !hasDraggedFiles(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (composeLocked || !hasDraggedFiles(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        if (composeLocked || !hasDraggedFiles(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragDepth(0);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length > 0) {
          legacyApi?.appendTelegramFiles(files);
        }
      }}
    >
      {dragActive ? (
        <div className="telegram-drop-target">Drop files to attach</div>
      ) : null}
      {voiceStatus ? (
        <div className={`telegram-voice-recorder-banner state-${voiceRecorderState}`}>
          <div className="telegram-voice-recorder-label">{voiceStatus}</div>
          {isRecording ? (
            <button
              type="button"
              className="telegram-voice-recorder-cancel"
              onClick={() => legacyApi?.cancelTelegramVoiceRecording()}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      {replyPreview ? (
        <div className="telegram-compose-reply">
          <div className="telegram-compose-reply-body">
            <div className="telegram-compose-reply-sender">{replyPreview.sender}</div>
            <div className="telegram-compose-reply-text">{replyPreview.text}</div>
          </div>
          <button
            type="button"
            className="telegram-compose-reply-close"
            onClick={() => legacyApi?.clearTelegramReply()}
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="telegram-compose-attachment">
          {attachments.map((attachment, index) => (
            <div key={attachment.id} className="telegram-compose-thumb-wrap">
              {attachment.kind === 'image' ? (
                <>
                  <img
                    className="telegram-compose-preview"
                    src={attachment.dataUrl}
                    alt={attachment.name || `Pasted image ${index + 1}`}
                  />
                  <div className="telegram-compose-image-mode" role="group" aria-label="Image send mode">
                    <button
                      type="button"
                      className={attachment.sendAs !== 'document' ? 'active' : ''}
                      onClick={() => legacyApi?.setTelegramAttachmentSendAs(attachment.id, 'image')}
                      aria-pressed={attachment.sendAs !== 'document'}
                    >
                      Image
                    </button>
                    <button
                      type="button"
                      className={attachment.sendAs === 'document' ? 'active' : ''}
                      onClick={() => legacyApi?.setTelegramAttachmentSendAs(attachment.id, 'document')}
                      aria-pressed={attachment.sendAs === 'document'}
                    >
                      File
                    </button>
                  </div>
                </>
              ) : (
                <div className="telegram-compose-document">
                  <div className="telegram-compose-document-name">{attachment.name}</div>
                  <div className="telegram-compose-document-meta">
                    {formatTelegramAttachmentMeta(attachment)}
                  </div>
                </div>
              )}
              <button
                type="button"
                className="telegram-compose-thumb-remove"
                onClick={() => legacyApi?.removeTelegramAttachment(attachment.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="telegram-compose-row">
        <button
          type="button"
          className="telegram-attach-button"
          disabled={composeLocked}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
        >
          +
        </button>
        <input
          ref={fileInputRef}
          className="telegram-attach-input"
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) {
              legacyApi?.appendTelegramFiles(files);
            }
            event.currentTarget.value = '';
          }}
        />
        <div
          className={`telegram-vim-mode-indicator mode-${composerMode}`}
          aria-label={`Composer ${composerMode} mode`}
        >
          {composerMode === 'insert'
            ? 'INS'
            : composerMode === 'visual'
              ? 'VIS'
              : composerMode === 'visual-line'
                ? 'VLI'
              : composerMode === 'visual-block'
                ? 'VBL'
                : 'NOR'}
        </div>
        <textarea
          id="telegram-compose-input"
          ref={(node) => {
            textareaRef.current = node;
            if (!inputRef) {
              return;
            }
            inputRef.current = node;
          }}
          className={`telegram-compose-input vim-${composerMode}`}
          data-vim-mode={composerMode}
          placeholder={placeholder}
          rows={1}
          disabled={composeLocked}
          value={value}
          aria-autocomplete="list"
          aria-controls={
            mentionCompletion
              ? 'telegram-mention-completion'
              : emojiCompletion
                ? 'telegram-emoji-completion'
                : undefined
          }
          aria-expanded={mentionCompletion || emojiCompletion ? 'true' : 'false'}
          aria-invalid={isOverTextLimit ? 'true' : undefined}
          aria-describedby={isOverTextLimit ? 'telegram-compose-limit-warning' : undefined}
          aria-activedescendant={
            mentionCompletion
              ? `telegram-mention-completion-item-${mentionCompletion.activeIndex}`
              : emojiCompletion
              ? `telegram-emoji-completion-item-${emojiCompletion.activeIndex}`
              : undefined
          }
          onBeforeInput={(event) => {
            if (composerMode !== 'insert' && isTrustedInputEvent(event)) {
              event.preventDefault();
            }
          }}
          onChange={(event) => {
            if (composerMode !== 'insert' && isTrustedInputEvent(event)) {
              event.target.value = value;
              return;
            }
            syncDraftValue(event.target.value);
            updateMentionCompletion(
              event.target.value,
              event.target.selectionStart,
              event.target.selectionEnd,
              true,
            );
            updateEmojiCompletion(
              event.target.value,
              event.target.selectionStart,
              event.target.selectionEnd,
            );
          }}
          onInput={(event) => {
            if (composerMode !== 'insert' && isTrustedInputEvent(event)) {
              event.currentTarget.value = value;
              return;
            }
            syncDraftValue(event.currentTarget.value);
            updateMentionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
            );
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onFocus={(event) => {
            updateMentionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
            );
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onBlur={() => {
            setEmojiCompletion(null);
            setMentionCompletion(null);
          }}
          onClick={(event) => {
            updateMentionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
            );
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onPaste={(event) => {
            const files = getClipboardFiles(event.clipboardData);
            if (composerMode !== 'insert') {
              event.preventDefault();
              if (files.length > 0) {
                legacyApi?.appendTelegramFiles(files);
              }
              return;
            }

            if (files.length < 1) {
              return;
            }

            event.preventDefault();
            legacyApi?.appendTelegramFiles(files);
          }}
          onSelect={(event) => {
            updateMentionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
            );
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onKeyDown={(event) => {
            if (composerMode === 'visual-block') {
              if (handleVisualBlockModeKeyDown(event)) {
                return;
              }
            }

            if (composerMode === 'visual-line') {
              if (handleVisualLineModeKeyDown(event)) {
                return;
              }
            }

            if (composerMode === 'visual') {
              if (handleVisualModeKeyDown(event)) {
                return;
              }
            }

            if (composerMode === 'normal') {
              if (handleNormalModeKeyDown(event)) {
                return;
              }
            }

            if (mentionCompletion && event.key === 'ArrowDown') {
              event.preventDefault();
              setMentionCompletion((current) =>
                current
                  ? {
                      ...current,
                      activeIndex: Math.min(
                        current.suggestions.length - 1,
                        current.activeIndex + 1,
                      ),
                    }
                  : current,
              );
              return;
            }

            if (mentionCompletion && event.key === 'ArrowUp') {
              event.preventDefault();
              setMentionCompletion((current) =>
                current
                  ? {
                      ...current,
                      activeIndex: Math.max(0, current.activeIndex - 1),
                    }
                  : current,
              );
              return;
            }

            if (
              mentionCompletion &&
              ((event.key === 'Enter' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey) ||
                (event.key === 'Tab' && !event.shiftKey))
            ) {
              event.preventDefault();
              applyMentionSuggestion();
              return;
            }

            if (mentionCompletion && event.key === 'Escape') {
              event.preventDefault();
              setMentionCompletion(null);
              return;
            }

            if (emojiCompletion && event.key === 'ArrowDown') {
              event.preventDefault();
              setEmojiCompletion((current) =>
                current
                  ? {
                      ...current,
                      activeIndex: Math.min(
                        current.suggestions.length - 1,
                        current.activeIndex + 1,
                      ),
                    }
                  : current,
              );
              return;
            }

            if (emojiCompletion && event.key === 'ArrowUp') {
              event.preventDefault();
              setEmojiCompletion((current) =>
                current
                  ? {
                      ...current,
                      activeIndex: Math.max(0, current.activeIndex - 1),
                    }
                  : current,
              );
              return;
            }

            if (
              emojiCompletion &&
              ((event.key === 'Enter' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey) ||
                (event.key === 'Tab' && !event.shiftKey))
            ) {
              event.preventDefault();
              applyEmojiSuggestion();
              return;
            }

            if (emojiCompletion && event.key === 'Escape') {
              event.preventDefault();
              setEmojiCompletion(null);
              return;
            }

            if (
              event.key === 'Escape' &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              event.preventDefault();
              requestComposerMode('normal');
              return;
            }

            const shouldSend =
              (sendBehavior === 'enter' && event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) ||
              (sendBehavior === 'mod-enter' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) ||
              (event.key === 'Enter' && (event.metaKey || event.ctrlKey));

            if (shouldSend) {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          type="button"
          className={`telegram-voice-record-button${isRecording ? ' recording' : ''}`}
          disabled={isPreparing || isSending || voiceRecorderState === 'unsupported'}
          aria-label={
            isRecording ? 'Stop and send voice note' : 'Record a voice note'
          }
          title={
            isRecording ? 'Stop and send voice note' : 'Record a voice note'
          }
          onClick={() => {
            if (isRecording) {
              legacyApi?.stopTelegramVoiceRecording();
              return;
            }
            legacyApi?.startTelegramVoiceRecording();
          }}
        >
          {isRecording ? '■' : '●'}
        </button>
        <button
          type="button"
          className={`telegram-send-button${isOverTextLimit ? ' limit-exceeded' : ''}`}
          disabled={composeLocked}
          onClick={handleSend}
        >
          ➤
        </button>
      </div>
      {isOverTextLimit ? (
        <div
          id="telegram-compose-limit-warning"
          className="telegram-compose-limit-warning"
          role="alert"
        >
          {nonVoiceAttachmentCount > 0
            ? `Caption is ${characterCount.toLocaleString()} / ${activeTextLimit.toLocaleString()} characters. Regular Telegram captions are limited to ${activeTextLimit.toLocaleString()}.`
            : `Message is ${characterCount.toLocaleString()} / ${activeTextLimit.toLocaleString()} characters.`}
        </div>
      ) : null}
      {limitDialogMessage ? (
        <div
          className="telegram-limit-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setLimitDialogMessage(null);
            }
          }}
        >
          <div
            className="telegram-limit-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="telegram-limit-dialog-title"
            aria-describedby="telegram-limit-dialog-message"
          >
            <div className="telegram-limit-dialog-eyebrow">Telegram limit</div>
            <div id="telegram-limit-dialog-title" className="telegram-limit-dialog-title">
              Message too long
            </div>
            <div id="telegram-limit-dialog-message" className="telegram-limit-dialog-message">
              {limitDialogMessage}
            </div>
            <div className="telegram-limit-dialog-actions">
              <button
                type="button"
                className="telegram-limit-dialog-button"
                autoFocus
                onClick={() => setLimitDialogMessage(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {mentionCompletion ? (
        <div
          id="telegram-mention-completion"
          className="telegram-mention-completion"
          role="listbox"
          aria-label="Mention suggestions"
        >
          {mentionCompletion.suggestions.map((suggestion, index) => (
            <button
              key={suggestion.mention}
              id={`telegram-mention-completion-item-${index}`}
              type="button"
              className={`telegram-mention-completion-item${
                index === mentionCompletion.activeIndex ? ' active' : ''
              }`}
              role="option"
              aria-selected={index === mentionCompletion.activeIndex ? 'true' : 'false'}
              onMouseEnter={() => {
                setMentionCompletion((current) =>
                  current
                    ? {
                        ...current,
                        activeIndex: index,
                      }
                    : current,
                );
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                applyMentionSuggestion(suggestion);
              }}
            >
              <span className="telegram-mention-completion-avatar">
                {suggestion.displayName.slice(0, 1).toUpperCase() || '@'}
              </span>
              <span className="telegram-mention-completion-copy">
                <span className="telegram-mention-completion-name">{suggestion.displayName}</span>
                <span className="telegram-mention-completion-handle">{suggestion.mention}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {emojiCompletion ? (
        <div
          id="telegram-emoji-completion"
          className="telegram-emoji-completion"
          role="listbox"
          aria-label="Emoji suggestions"
        >
          {emojiCompletion.suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.emoji}:${suggestion.canonicalAlias}:${suggestion.matchedAlias}`}
              id={`telegram-emoji-completion-item-${index}`}
              type="button"
              className={`telegram-emoji-completion-item${
                index === emojiCompletion.activeIndex ? ' active' : ''
              }`}
              role="option"
              aria-selected={index === emojiCompletion.activeIndex ? 'true' : 'false'}
              onMouseEnter={() => {
                setEmojiCompletion((current) =>
                  current
                    ? {
                        ...current,
                        activeIndex: index,
                      }
                    : current,
                );
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                applyEmojiSuggestion(suggestion);
              }}
            >
              <span className="telegram-emoji-completion-value">{suggestion.emoji}</span>
              <span className="telegram-emoji-completion-copy">
                <span className="telegram-emoji-completion-alias">
                  :{suggestion.canonicalAlias}:
                </span>
                {suggestion.matchedAlias !== suggestion.canonicalAlias ? (
                  <span className="telegram-emoji-completion-match">
                    via :{suggestion.matchedAlias}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    target,
  );
};
