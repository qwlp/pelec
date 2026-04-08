import { useEffect, useRef } from 'react';
import type { ChatSummary } from '../../../shared/connectors';

interface TelegramForwardDialogProps {
  chats: ChatSummary[];
  onClose(): void;
  onForward(chatId: string): void;
  onQueryChange(query: string): void;
  query: string;
  sending: boolean;
}

const TelegramForwardAvatar = ({ chat }: { chat: ChatSummary }) => {
  const title = chat.title.trim() || 'U';

  if (chat.avatarUrl) {
    return (
      <div className="telegram-avatar" aria-hidden="true">
        <img src={chat.avatarUrl} alt="" />
      </div>
    );
  }

  return <div className="telegram-avatar">{title.slice(0, 1).toUpperCase()}</div>;
};

export const TelegramForwardDialog = ({
  chats,
  onClose,
  onForward,
  onQueryChange,
  query,
  sending,
}: TelegramForwardDialogProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="qr-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget && !sending) {
          onClose();
        }
      }}
    >
      <div className="telegram-forward-card">
        <header className="telegram-forward-header">
          <button
            type="button"
            className="telegram-forward-close"
            aria-label="Close forward picker"
            onClick={onClose}
            disabled={sending}
          >
            x
          </button>
          <div className="telegram-forward-title">Forward to...</div>
        </header>
        <div className="telegram-forward-search-shell">
          <input
            ref={inputRef}
            className="telegram-forward-search"
            type="text"
            placeholder="Search chats"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            disabled={sending}
          />
        </div>
        <div className="telegram-forward-list">
          {chats.length < 1 ? (
            <div className="telegram-forward-empty">
              {query.trim() ? 'No chats match your search.' : 'No other Telegram chats are available.'}
            </div>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className="telegram-forward-chat-item"
                disabled={sending}
                onClick={() => onForward(chat.id)}
              >
                <TelegramForwardAvatar chat={chat} />
                <div className="telegram-forward-chat-copy">
                  <div className="telegram-forward-chat-title">{chat.title || 'Untitled chat'}</div>
                  <div className="telegram-forward-chat-preview">
                    {chat.lastMessagePreview.trim() || 'No recent activity'}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
