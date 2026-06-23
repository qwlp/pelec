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
import { Mic, Paperclip, SendHorizontal, SmilePlus, Square, X } from 'lucide-react';
import type { AppMode } from '../../../shared/types';
import type { PendingTelegramAttachment } from './media';
import type {
  LegacyAppBridgeApi,
  LegacyTelegramEditState,
  LegacyTelegramReplyPreview,
} from '../../legacyBridge';
import {
  buildTelegramEmojiSuggestions,
  getTelegramEmojiTokenMatch,
  type TelegramEmojiSuggestion,
} from '../../lib/emoji';
import { formatTelegramAttachmentMeta } from './media';
import { TelegramMediaPicker } from './TelegramMediaPicker';

interface TelegramComposerProps {
  activeChatId?: string | null;
  appMode?: AppMode;
  attachments: PendingTelegramAttachment[];
  canSend: boolean;
  draftText: string;
  editing: LegacyTelegramEditState;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  legacyApi: LegacyAppBridgeApi | null;
  mentionSuggestions?: TelegramMentionSuggestion[];
  onModeChange?: (mode: AppMode) => void;
  replyToMessageId?: string | null;
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

type TelegramTextExpansionSuggestion = {
  command: string;
  description: string;
  getValue: () => string;
};

type TelegramTextExpansionCompletionState = {
  activeIndex: number;
  suggestions: TelegramTextExpansionSuggestion[];
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
const TELEGRAM_TEXT_EXPANSION_PATTERN = /^::([A-Za-z]+)(?:\(([^)]*)\))?$/u;

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

const formatTelegramExpansionDate = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);

const formatTelegramExpansionTime = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

const addTelegramExpansionDays = (date: Date, days: number): Date => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const getSecureRandomInt = (maxExclusive: number): number => {
  if (maxExclusive <= 1) {
    return 0;
  }

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  const buffer = new Uint32Array(1);

  do {
    cryptoApi.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return buffer[0] % maxExclusive;
};

const getRandomCharacters = (characters: string, length: number): string => {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += characters[getSecureRandomInt(characters.length)] ?? '';
  }
  return result;
};

const parsePositiveInteger = (value: string | undefined, fallback: number, max = 256): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(max, parsed);
};

const rollTelegramDice = (argument: string | undefined): string => {
  const input = (argument ?? '20').trim().toLowerCase();
  const multiDiceMatch = /^(\d*)d(\d+)$/u.exec(input);

  if (multiDiceMatch) {
    const diceCount = Math.min(100, parsePositiveInteger(multiDiceMatch[1], 1));
    const sides = Math.min(1000000, parsePositiveInteger(multiDiceMatch[2], 20, 1000000));
    let total = 0;
    for (let index = 0; index < diceCount; index += 1) {
      total += getSecureRandomInt(sides) + 1;
    }
    return String(total);
  }

  const sides = Math.min(1000000, parsePositiveInteger(input, 20, 1000000));
  return String(getSecureRandomInt(sides) + 1);
};

const buildTelegramTextExpansionValue = (token: string): string | null => {
  const match = TELEGRAM_TEXT_EXPANSION_PATTERN.exec(token.trim());
  if (!match) {
    return null;
  }

  const command = (match[1] ?? '').toLowerCase();
  const argument = match[2]?.trim();
  const now = new Date();

  if (command === 'today' || command === 'date') {
    const offset = command === 'today' ? Number.parseInt(argument ?? '0', 10) : 0;
    return formatTelegramExpansionDate(addTelegramExpansionDays(now, Number.isFinite(offset) ? offset : 0));
  }

  if (command === 'tomorrow') {
    return formatTelegramExpansionDate(addTelegramExpansionDays(now, 1));
  }

  if (command === 'yesterday') {
    return formatTelegramExpansionDate(addTelegramExpansionDays(now, -1));
  }

  if (command === 'now' || command === 'time') {
    return formatTelegramExpansionTime(now);
  }

  if (command === 'roll') {
    return rollTelegramDice(argument);
  }

  if (command === 'random') {
    const [kind = 'alnum', lengthText = '16'] = (argument ?? '').split(',').map((part) => part.trim());
    const length = parsePositiveInteger(lengthText, 16, 256);
    if (kind === 'str') {
      return getRandomCharacters('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', length);
    }
    if (kind === 'int') {
      return getRandomCharacters('0123456789', length);
    }
    if (kind === 'alnum') {
      return getRandomCharacters('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', length);
    }
  }

  return null;
};

const TELEGRAM_TEXT_EXPANSION_SUGGESTIONS: TelegramTextExpansionSuggestion[] = [
  { command: '::today', description: 'Current date', getValue: () => buildTelegramTextExpansionValue('::today') ?? '' },
  { command: '::tomorrow', description: "Tomorrow's date", getValue: () => buildTelegramTextExpansionValue('::tomorrow') ?? '' },
  { command: '::yesterday', description: "Yesterday's date", getValue: () => buildTelegramTextExpansionValue('::yesterday') ?? '' },
  { command: '::today(5)', description: 'Date offset by days', getValue: () => buildTelegramTextExpansionValue('::today(5)') ?? '' },
  { command: '::now', description: 'Current local time', getValue: () => buildTelegramTextExpansionValue('::now') ?? '' },
  { command: '::roll(d20)', description: 'Roll a die', getValue: () => buildTelegramTextExpansionValue('::roll(d20)') ?? '' },
  { command: '::roll(4d6)', description: 'Roll multiple dice', getValue: () => buildTelegramTextExpansionValue('::roll(4d6)') ?? '' },
  { command: '::random(str, 20)', description: 'Random letters', getValue: () => buildTelegramTextExpansionValue('::random(str, 20)') ?? '' },
  { command: '::random(int, 10)', description: 'Random digits', getValue: () => buildTelegramTextExpansionValue('::random(int, 10)') ?? '' },
  { command: '::random(alnum, 16)', description: 'Random letters and digits', getValue: () => buildTelegramTextExpansionValue('::random(alnum, 16)') ?? '' },
];

const getTelegramTextExpansionTokenMatch = (
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
  const match = /(^|\s)(::[^\n]*)$/u.exec(beforeCursor);
  if (!match) {
    return null;
  }

  const token = match[2] ?? '';
  return {
    query: token.toLowerCase(),
    tokenEnd: selectionStart,
    tokenStart: selectionStart - token.length,
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
  activeChatId = null,
  appMode = 'insert',
  attachments,
  canSend,
  draftText,
  editing,
  inputRef,
  legacyApi,
  mentionSuggestions = [],
  onModeChange,
  replyToMessageId,
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
  const [textExpansionCompletion, setTextExpansionCompletion] =
    useState<TelegramTextExpansionCompletionState | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [dragDepth, setDragDepth] = useState(0);
  const [limitDialogMessage, setLimitDialogMessage] = useState<string | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaPickerToggleRef = useRef<HTMLButtonElement | null>(null);
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

  const insertEmojiAtCursor = (emoji: string) => {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? value.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const start = clampIndex(Math.min(selectionStart, selectionEnd), value);
    const end = clampIndex(Math.max(selectionStart, selectionEnd), value);
    const nextValue = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
    syncDraftValueWithSelection(nextValue, start + emoji.length);
    setEmojiCompletion(null);
    setMentionCompletion(null);
    setTextExpansionCompletion(null);
    window.requestAnimationFrame?.(() => {
      textareaRef.current?.focus();
    }) ?? window.setTimeout(() => textareaRef.current?.focus(), 0);
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
    updateTextExpansionCompletion(value, start, end);
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

    if (getTelegramTextExpansionTokenMatch(nextValue, selectionStart, selectionEnd)) {
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

  const updateTextExpansionCompletion = (
    nextValue = value,
    selectionStart = textareaRef.current?.selectionStart ?? null,
    selectionEnd = textareaRef.current?.selectionEnd ?? null,
    force = false,
  ) => {
    if (!force && document.activeElement !== textareaRef.current) {
      setTextExpansionCompletion(null);
      return;
    }

    const tokenMatch = getTelegramTextExpansionTokenMatch(nextValue, selectionStart, selectionEnd);
    if (!tokenMatch) {
      setTextExpansionCompletion(null);
      return;
    }

    const suggestions = TELEGRAM_TEXT_EXPANSION_SUGGESTIONS.filter((suggestion) =>
      suggestion.command.toLowerCase().startsWith(tokenMatch.query),
    ).slice(0, 8);

    if (suggestions.length < 1) {
      setTextExpansionCompletion(null);
      return;
    }

    setEmojiCompletion(null);
    setMentionCompletion(null);
    setTextExpansionCompletion((current) => {
      const currentSuggestion = current?.suggestions[current.activeIndex];
      const matchedIndex = currentSuggestion
        ? suggestions.findIndex((suggestion) => suggestion.command === currentSuggestion.command)
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
    setTextExpansionCompletion(null);
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
    setTextExpansionCompletion(null);
    textareaRef.current?.focus();
    return true;
  };

  const applyTextExpansionSuggestion = (
    suggestion?: TelegramTextExpansionSuggestion,
    appendTrailingSpace = false,
  ): boolean => {
    const textarea = textareaRef.current;
    const tokenStart = textExpansionCompletion?.tokenStart;
    const tokenEnd = textExpansionCompletion?.tokenEnd;
    const activeSuggestion =
      suggestion ?? textExpansionCompletion?.suggestions[textExpansionCompletion.activeIndex];

    if (typeof tokenStart !== 'number' || typeof tokenEnd !== 'number') {
      const selectionStart = textarea?.selectionStart ?? value.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const directMatch = getTelegramTextExpansionTokenMatch(value, selectionStart, selectionEnd);
      const directValue = directMatch
        ? buildTelegramTextExpansionValue(value.slice(directMatch.tokenStart, directMatch.tokenEnd))
        : null;
      if (!directMatch || directValue === null) {
        setTextExpansionCompletion(null);
        return false;
      }

      const suffix = appendTrailingSpace ? ' ' : '';
      const nextValue = `${value.slice(0, directMatch.tokenStart)}${directValue}${suffix}${value.slice(
        directMatch.tokenEnd,
      )}`;
      const nextSelection = directMatch.tokenStart + directValue.length + suffix.length;
      syncDraftValueWithSelection(nextValue, nextSelection);
      setTextExpansionCompletion(null);
      textareaRef.current?.focus();
      return true;
    }

    const expansionValue = activeSuggestion?.getValue() ?? buildTelegramTextExpansionValue(value.slice(tokenStart, tokenEnd));
    if (!expansionValue) {
      setTextExpansionCompletion(null);
      return false;
    }

    const suffix = appendTrailingSpace ? ' ' : '';
    const nextValue = `${value.slice(0, tokenStart)}${expansionValue}${suffix}${value.slice(tokenEnd)}`;
    const nextSelection = tokenStart + expansionValue.length + suffix.length;

    syncDraftValueWithSelection(nextValue, nextSelection);
    setTextExpansionCompletion(null);
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
  }, [value, attachments.length, editing.messageId, replyPreview]);

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
    if (editing.messageId) {
      return 'Edit your message...';
    }
    if (replyPreview) {
      return `Reply to ${replyPreview.sender}`;
    }
    if (attachments.length > 0) {
      return 'Type a caption...';
    }
    return 'Type your message here...';
  }, [attachments.length, editing.messageId, replyPreview]);

  const isRecording = voiceRecorderState === 'recording';
  const isPreparing = voiceRecorderState === 'preparing';
  const isSending = voiceRecorderState === 'sending';
  const composeLocked = isRecording || isPreparing || isSending;
  const dragActive = dragDepth > 0 && !composeLocked;

  useEffect(() => {
    if (!activeChatId || !canSend || composeLocked) {
      setMediaPickerOpen(false);
    }
  }, [activeChatId, canSend, composeLocked]);

  useEffect(() => {
    if (!mediaPickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target;
      if (!(targetNode instanceof Node)) {
        return;
      }

      if (
        mediaPickerRef.current?.contains(targetNode) ||
        mediaPickerToggleRef.current?.contains(targetNode)
      ) {
        return;
      }

      setMediaPickerOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [mediaPickerOpen]);

  useEffect(() => {
    document.body.classList.toggle('telegram-media-picker-open', mediaPickerOpen);

    return () => {
      document.body.classList.remove('telegram-media-picker-open');
    };
  }, [mediaPickerOpen]);

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
      {editing.messageId ? (
        <div className="telegram-compose-reply telegram-compose-edit">
          <div className="telegram-compose-reply-body">
            <div className="telegram-compose-reply-sender">Editing message</div>
            <div className="telegram-compose-reply-text">{editing.originalText}</div>
          </div>
          <button
            type="button"
            className="telegram-compose-reply-close"
            onClick={() => legacyApi?.cancelTelegramEdit()}
            aria-label="Cancel edit"
          >
            <X aria-hidden="true" size={16} strokeWidth={2.2} />
          </button>
        </div>
      ) : replyPreview ? (
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
      {mediaPickerOpen && activeChatId ? (
        <TelegramMediaPicker
          ref={mediaPickerRef}
          chatId={activeChatId}
          disabled={composeLocked || !canSend || !!editing.messageId}
          onClose={() => setMediaPickerOpen(false)}
          onEmojiInsert={insertEmojiAtCursor}
          onSent={() => {
            legacyApi?.clearTelegramReply();
            legacyApi?.refresh();
          }}
          replyToMessageId={replyToMessageId ?? undefined}
        />
      ) : null}
      <div className="telegram-compose-row">
        <button
          type="button"
          className="telegram-attach-button"
          disabled={composeLocked || !!editing.messageId}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
        >
          <Paperclip aria-hidden="true" size={18} strokeWidth={2.1} />
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
            textExpansionCompletion
              ? 'telegram-text-expansion-completion'
              : mentionCompletion
              ? 'telegram-mention-completion'
              : emojiCompletion
                ? 'telegram-emoji-completion'
                : undefined
          }
          aria-expanded={textExpansionCompletion || mentionCompletion || emojiCompletion ? 'true' : 'false'}
          aria-invalid={isOverTextLimit ? 'true' : undefined}
          aria-describedby={isOverTextLimit ? 'telegram-compose-limit-warning' : undefined}
          aria-activedescendant={
            textExpansionCompletion
              ? `telegram-text-expansion-completion-item-${textExpansionCompletion.activeIndex}`
              : mentionCompletion
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
            updateTextExpansionCompletion(
              event.target.value,
              event.target.selectionStart,
              event.target.selectionEnd,
              true,
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
            updateTextExpansionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
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
            updateTextExpansionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
            );
          }}
          onBlur={() => {
            setEmojiCompletion(null);
            setMentionCompletion(null);
            setTextExpansionCompletion(null);
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
            updateTextExpansionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
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
            updateTextExpansionCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              true,
            );
          }}
          onKeyDown={(event) => {
            if (
              mediaPickerOpen &&
              event.key === 'Escape' &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              event.preventDefault();
              setMediaPickerOpen(false);
              return;
            }

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

            if (textExpansionCompletion && event.key === 'ArrowDown') {
              event.preventDefault();
              setTextExpansionCompletion((current) =>
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

            if (textExpansionCompletion && event.key === 'ArrowUp') {
              event.preventDefault();
              setTextExpansionCompletion((current) =>
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
              textExpansionCompletion &&
              ((event.key === 'Enter' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey) ||
                (event.key === 'Tab' && !event.shiftKey) ||
                (event.key === ' ' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey))
            ) {
              event.preventDefault();
              applyTextExpansionSuggestion(undefined, event.key === ' ');
              return;
            }

            if (textExpansionCompletion && event.key === 'Escape') {
              event.preventDefault();
              setTextExpansionCompletion(null);
              return;
            }

            if (
              ((event.key === 'Enter' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey) ||
                (event.key === 'Tab' && !event.shiftKey) ||
                (event.key === ' ' &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey)) &&
              getTelegramTextExpansionTokenMatch(
                value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              )
            ) {
              event.preventDefault();
              if (applyTextExpansionSuggestion(undefined, event.key === ' ')) {
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
              const cursor = Math.min(
                event.currentTarget.selectionStart ?? 0,
                event.currentTarget.selectionEnd ?? 0,
              );
              moveTextareaCursor(Math.max(0, cursor - 1));
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
          ref={mediaPickerToggleRef}
          type="button"
          className={`telegram-picker-toggle${mediaPickerOpen ? ' active' : ''}`}
          disabled={composeLocked || !activeChatId || !!editing.messageId}
          onClick={() => {
            setMediaPickerOpen((open) => !open);
            setEmojiCompletion(null);
            setMentionCompletion(null);
            setTextExpansionCompletion(null);
          }}
          aria-label="Open emoji, sticker, and GIF picker"
          aria-expanded={mediaPickerOpen ? 'true' : 'false'}
        >
          <SmilePlus aria-hidden="true" size={20} strokeWidth={2} />
        </button>
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
          {isRecording ? (
            <Square aria-hidden="true" size={16} strokeWidth={2.4} />
          ) : (
            <Mic aria-hidden="true" size={18} strokeWidth={2.1} />
          )}
        </button>
        <button
          type="button"
          className={`telegram-send-button${isOverTextLimit ? ' limit-exceeded' : ''}`}
          disabled={composeLocked}
          onClick={handleSend}
        >
          <SendHorizontal aria-hidden="true" size={18} strokeWidth={2.1} />
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
      {textExpansionCompletion ? (
        <div
          id="telegram-text-expansion-completion"
          className="telegram-text-expansion-completion"
          role="listbox"
          aria-label="Text expansion suggestions"
        >
          {textExpansionCompletion.suggestions.map((suggestion, index) => (
            <button
              key={suggestion.command}
              id={`telegram-text-expansion-completion-item-${index}`}
              type="button"
              className={`telegram-text-expansion-completion-item${
                index === textExpansionCompletion.activeIndex ? ' active' : ''
              }`}
              role="option"
              aria-selected={index === textExpansionCompletion.activeIndex ? 'true' : 'false'}
              onMouseEnter={() => {
                setTextExpansionCompletion((current) =>
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
                applyTextExpansionSuggestion(suggestion);
              }}
            >
              <span className="telegram-text-expansion-command">{suggestion.command}</span>
              <span className="telegram-text-expansion-copy">
                <span className="telegram-text-expansion-description">
                  {suggestion.description}
                </span>
                <span className="telegram-text-expansion-preview">{suggestion.getValue()}</span>
              </span>
            </button>
          ))}
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
