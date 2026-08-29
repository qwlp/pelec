import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Film, SmilePlus, Sticker, type LucideIcon } from 'lucide-react';
import type {
  TelegramPickerItem,
  TelegramPickerItemKind,
} from '../../../shared/connectors';
import { getTelegramEmojiCatalog } from '../../lib/emoji';

type TelegramMediaPickerTab = 'emoji' | TelegramPickerItemKind;

interface TelegramMediaPickerProps {
  chatId: string;
  disabled?: boolean;
  onClose: () => void;
  onEmojiInsert: (emoji: string) => void;
  onSent?: () => void;
  replyToMessageId?: string;
}

const TELEGRAM_PICKER_LIMIT = 48;
const TELEGRAM_PICKER_COLUMNS = 8;

type TelegramMediaPickerTabConfig = {
  icon: LucideIcon;
  label: string;
  tab: TelegramMediaPickerTab;
};

const isVideoPreview = (item: TelegramPickerItem): boolean => {
  const mimeType = item.previewMimeType?.trim().toLowerCase();
  if (mimeType) {
    return mimeType.startsWith('video/');
  }

  const url = item.previewUrl.toLowerCase();
  return (
    url.includes('.webm') ||
    url.includes('.mp4') ||
    url.startsWith('data:video/')
  );
};

export const TelegramMediaPicker = forwardRef<HTMLDivElement, TelegramMediaPickerProps>(({
  chatId,
  disabled = false,
  onClose,
  onEmojiInsert,
  onSent,
  replyToMessageId,
}, ref) => {
  const [activeTab, setActiveTab] = useState<TelegramMediaPickerTab>('emoji');
  const [items, setItems] = useState<TelegramPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const emojiItems = getTelegramEmojiCatalog().slice(0, 96);

  const gridLength = activeTab === 'emoji' ? emojiItems.length : items.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'emoji') {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSendError(null);

    window.pelec
      .listTelegramPickerItems('telegram', {
        kind: activeTab,
        limit: TELEGRAM_PICKER_LIMIT,
      })
      .then((nextItems) => {
        if (!cancelled) {
          setItems(nextItems);
        }
      })
      .catch((failure) => {
        if (!cancelled) {
          setItems([]);
          setError(failure instanceof Error ? failure.message : 'Failed loading Telegram media.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, reloadToken]);

  useEffect(() => {
    const activeElement = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-picker-index="${activeIndex}"]`,
    );
    if (activeElement && document.activeElement?.closest('.telegram-media-picker-grid')) {
      activeElement.focus();
    }
  }, [activeIndex]);

  const activateCurrent = () => {
    if (disabled || gridLength < 1) {
      return;
    }

    if (activeTab === 'emoji') {
      const emoji = emojiItems[activeIndex]?.emoji;
      if (emoji) {
        onEmojiInsert(emoji);
      }
      return;
    }

    const item = items[activeIndex];
    if (item) {
      void sendItem(item);
    }
  };

  const sendItem = async (item: TelegramPickerItem): Promise<void> => {
    if (disabled) {
      return;
    }

    setSendError(null);
    const sent = await window.pelec.sendTelegramPickerItem(
      'telegram',
      chatId,
      item,
      replyToMessageId,
    );
    if (!sent) {
      setSendError(`Failed to send ${item.kind === 'gif' ? 'GIF' : 'sticker'}.`);
      return;
    }

    onSent?.();
    onClose();
  };

  const moveActive = (nextIndex: number) => {
    if (gridLength < 1) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex(Math.max(0, Math.min(gridLength - 1, nextIndex)));
  };

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activateCurrent();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveActive(activeIndex + 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveActive(activeIndex - 1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(activeIndex + TELEGRAM_PICKER_COLUMNS);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(activeIndex - TELEGRAM_PICKER_COLUMNS);
    }
  };

  const emptyCopy =
    activeTab === 'emoji'
      ? 'No emoji match.'
      : activeTab === 'gif'
        ? 'No saved Telegram GIFs.'
        : 'No recent Telegram stickers.';

  return (
    <div
      ref={ref}
      className="telegram-media-picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {error || sendError ? (
        <div className="telegram-media-picker-error" role="alert">
          <span>{sendError ?? error}</span>
          {error ? (
            <button type="button" onClick={() => setReloadToken((token) => token + 1)}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={gridRef}
        className="telegram-media-picker-grid"
        role="grid"
        aria-label={`${activeTab} picker`}
        onKeyDown={handleGridKeyDown}
      >
        {loading && activeTab !== 'emoji'
          ? Array.from({ length: 24 }, (_, index) => (
              <div key={index} className="telegram-media-picker-skeleton" />
            ))
          : null}
        {!loading && gridLength < 1 ? (
          <div className="telegram-media-picker-empty">{emptyCopy}</div>
        ) : null}
        {!loading && activeTab === 'emoji'
          ? emojiItems.map((entry, index) => (
              <button
                key={`${entry.emoji}:${entry.aliases[0]}`}
                type="button"
                className={`telegram-media-picker-emoji${index === activeIndex ? ' active' : ''}`}
                data-picker-index={index}
                role="gridcell"
                title={`:${entry.aliases[0]}:`}
                onMouseDown={(event) => event.preventDefault()}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onEmojiInsert(entry.emoji)}
              >
                {entry.emoji}
              </button>
            ))
          : null}
        {!loading && activeTab !== 'emoji'
          ? items.map((item, index) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                className={`telegram-media-picker-media${index === activeIndex ? ' active' : ''}`}
                data-picker-index={index}
                role="gridcell"
                title={item.emoji ? `${item.kind} ${item.emoji}` : item.kind}
                onMouseDown={(event) => event.preventDefault()}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void sendItem(item)}
              >
                {isVideoPreview(item) ? (
                  <video src={item.previewUrl} muted loop playsInline autoPlay />
                ) : (
                  <img src={item.previewUrl} alt={item.emoji ? `Sticker ${item.emoji}` : item.kind} />
                )}
              </button>
            ))
          : null}
      </div>
      <div className="telegram-media-picker-tabs" role="tablist" aria-label="Telegram media">
        {([
          { tab: 'emoji', label: 'Emoji', icon: SmilePlus },
          { tab: 'sticker', label: 'Stickers', icon: Sticker },
          { tab: 'gif', label: 'GIFs', icon: Film },
        ] satisfies TelegramMediaPickerTabConfig[]).map(({ tab, label, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            className={`telegram-media-picker-tab${activeTab === tab ? ' active' : ''}`}
            role="tab"
            aria-selected={activeTab === tab ? 'true' : 'false'}
            aria-label={label}
            title={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setActiveTab(tab);
            }}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={2} />
          </button>
        ))}
      </div>
    </div>
  );
});

TelegramMediaPicker.displayName = 'TelegramMediaPicker';
