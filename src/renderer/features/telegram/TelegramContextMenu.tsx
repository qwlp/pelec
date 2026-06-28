import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatReaction } from '../../../shared/connectors';

const TELEGRAM_QUICK_REACTIONS = ['👍', '❤', '😁', '🔥', '👏', '🙏'] as const;
const TELEGRAM_REACTION_RECENCY_KEY = 'pelec.telegramRecentReactions';
const TELEGRAM_MORE_REACTIONS = [
  '👎',
  '🥰',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '👌',
  '🕊',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '😐',
  '🍓',
  '🍾',
  '💋',
  '🖕',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '🙈',
  '😇',
  '😨',
  '🤝',
  '✍',
  '🤗',
  '🫡',
] as const;
const TELEGRAM_ALL_REACTIONS = [
  ...TELEGRAM_QUICK_REACTIONS,
  ...TELEGRAM_MORE_REACTIONS,
] as const;
const TELEGRAM_REACTION_SET = new Set<string>(TELEGRAM_ALL_REACTIONS);
const TELEGRAM_QUICK_REACTION_COUNT = 6;

const readTelegramRecentReactions = (): string[] => {
  try {
    const raw = window.localStorage.getItem(TELEGRAM_REACTION_RECENCY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((reaction): reaction is string => TELEGRAM_REACTION_SET.has(reaction))
      : [];
  } catch {
    return [];
  }
};

const writeTelegramRecentReactions = (reactions: string[]): void => {
  try {
    window.localStorage.setItem(TELEGRAM_REACTION_RECENCY_KEY, JSON.stringify(reactions));
  } catch {
    // Recency is a local convenience only.
  }
};

const promoteTelegramReaction = (reactions: string[], reaction: string): string[] => [
  reaction,
  ...reactions.filter((candidate) => candidate !== reaction),
].filter((candidate, index, list) => TELEGRAM_REACTION_SET.has(candidate) && list.indexOf(candidate) === index);

const buildQuickReactions = (recentReactions: string[]): string[] =>
  promoteTelegramReaction(
    [
      ...recentReactions,
      ...TELEGRAM_QUICK_REACTIONS,
      ...TELEGRAM_MORE_REACTIONS,
    ],
    recentReactions[0] ?? TELEGRAM_QUICK_REACTIONS[0],
  ).slice(0, TELEGRAM_QUICK_REACTION_COUNT);

interface TelegramContextMenuProps {
  canEdit: boolean;
  currentReactions?: ChatReaction[];
  messageId: string;
  onClose(): void;
  onCopy(messageId: string): void;
  onDelete(messageId: string): void;
  onEdit(messageId: string): void;
  onForward(messageId: string): void;
  onReact(messageId: string, reaction: string): void;
  onReply(messageId: string): void;
  onSelect(messageId: string): void;
  x: number;
  y: number;
}

export const TelegramContextMenu = ({
  canEdit,
  currentReactions = [],
  messageId,
  onClose,
  onCopy,
  onDelete,
  onEdit,
  onForward,
  onReact,
  onReply,
  onSelect,
  x,
  y,
}: TelegramContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [recentReactions, setRecentReactions] = useState(readTelegramRecentReactions);
  const [moreOpen, setMoreOpen] = useState(false);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - rect.width - 12)),
      top: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - rect.height - 12)),
    });
  }, [x, y]);

  const actions = useMemo(
    () => [
      { id: 'copy', label: 'Copy', run: () => onCopy(messageId), visible: true },
      { id: 'select', label: 'Select', run: () => onSelect(messageId), visible: true },
      { id: 'edit', label: 'Edit', run: () => onEdit(messageId), visible: canEdit },
      { id: 'forward', label: 'Forward', run: () => onForward(messageId), visible: true },
      { id: 'reply', label: 'Reply', run: () => onReply(messageId), visible: true },
      { id: 'delete', label: 'Delete', run: () => onDelete(messageId), visible: true },
    ].filter((action) => action.visible),
    [canEdit, messageId, onCopy, onDelete, onEdit, onForward, onReply, onSelect],
  );

  const chosenReactions = useMemo(
    () =>
      new Set(
        currentReactions
          .filter((reaction) => reaction.chosen === true)
          .map((reaction) => reaction.value),
      ),
    [currentReactions],
  );
  const quickReactions = useMemo(() => buildQuickReactions(recentReactions), [recentReactions]);
  const moreReactions = useMemo(
    () => TELEGRAM_ALL_REACTIONS.filter((reaction) => !quickReactions.includes(reaction)),
    [quickReactions],
  );

  const handleReaction = (reaction: string) => {
    const nextRecentReactions = promoteTelegramReaction(recentReactions, reaction);
    setRecentReactions(nextRecentReactions);
    writeTelegramRecentReactions(nextRecentReactions);
    onReact(messageId, reaction);
    onClose();
  };

  return (
    <div className="telegram-context-menu-layer" onMouseDown={onClose}>
      <div
        ref={menuRef}
        className="telegram-context-menu"
        role="menu"
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="telegram-context-menu-reactions" role="group" aria-label="Reactions">
          {quickReactions.map((reaction) => (
            <button
              key={reaction}
              type="button"
              className={`telegram-context-menu-reaction${
                chosenReactions.has(reaction) ? ' chosen' : ''
              }`}
              aria-pressed={chosenReactions.has(reaction)}
              onClick={() => {
                handleReaction(reaction);
              }}
            >
              {reaction}
            </button>
          ))}
          <button
            type="button"
            className={`telegram-context-menu-reaction more${moreOpen ? ' open' : ''}`}
            aria-expanded={moreOpen}
            aria-label="More reactions"
            onClick={() => {
              setMoreOpen((value) => !value);
            }}
          >
            +
          </button>
        </div>
        {moreOpen ? (
          <div className="telegram-context-menu-reaction-picker" role="menu" aria-label="More reactions">
            {moreReactions.map((reaction) => (
              <button
                key={reaction}
                type="button"
                className={`telegram-context-menu-reaction picker${
                  chosenReactions.has(reaction) ? ' chosen' : ''
                }`}
                aria-pressed={chosenReactions.has(reaction)}
                onClick={() => {
                  handleReaction(reaction);
                }}
              >
                {reaction}
              </button>
            ))}
          </div>
        ) : null}
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="telegram-context-menu-item"
            role="menuitem"
            onClick={() => {
              action.run();
              onClose();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};
