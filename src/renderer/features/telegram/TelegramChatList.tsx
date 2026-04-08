import type { ReactNode, RefObject } from 'react';
import type { ChatSummary } from '../../../shared/connectors';

interface TelegramChatListProps {
  activeChatId: string | null;
  chats: ChatSummary[];
  listRef?: RefObject<HTMLElement | null>;
  loadError: string | null;
  loading: boolean;
  onSearchQueryChange(query: string): void;
  onSelectChat(chatId: string): void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedChatId: string | null;
}

const buildInitials = (label: string): string => {
  const words = label
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length < 1) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const formatUnreadBadge = (count: number): string => {
  if (count > 99) {
    return '99+';
  }
  return String(Math.max(0, Math.floor(count)));
};

const renderAvatar = (chat: ChatSummary) => {
  const title = chat.title.trim() || 'Untitled chat';
  if (chat.avatarUrl) {
    return (
      <div className="telegram-avatar">
        <img src={chat.avatarUrl} alt={`${title} avatar`} loading="lazy" />
      </div>
    );
  }

  return <div className="telegram-avatar fallback">{buildInitials(title)}</div>;
};

export const TelegramChatList = ({
  activeChatId,
  chats,
  listRef,
  loadError,
  loading,
  onSearchQueryChange,
  onSelectChat,
  searchInputRef,
  searchQuery,
  selectedChatId,
}: TelegramChatListProps) => {
  let content: ReactNode;
  if (loading && chats.length < 1) {
    content = <div className="telegram-empty">Loading chats...</div>;
  } else if (loadError) {
    content = <div className="telegram-empty">{loadError}</div>;
  } else if (chats.length < 1) {
    content = <div className="telegram-empty">No chats match your search.</div>;
  } else {
    content = (
      <>
        {chats.map((chat) => {
          const unreadCount = Math.max(0, Math.floor(chat.unreadCount));
          const title = chat.title.trim() || 'Untitled chat';
          const preview = chat.lastMessagePreview.trim() || 'No preview';
          const isActive = activeChatId === chat.id;
          const isSelected = selectedChatId === chat.id;

          return (
            <button
              key={chat.id}
              type="button"
              className={`telegram-chat-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}${
                unreadCount > 0 ? ' unread' : ' read'
              }${chat.isMuted ? ' muted' : ''}`}
              onClick={() => onSelectChat(chat.id)}
            >
              {renderAvatar(chat)}
              <div className="telegram-chat-content">
                <div className="telegram-chat-top">
                  <div className="telegram-chat-name">{title}</div>
                  <div className="telegram-chat-date" />
                </div>
                <div className="telegram-chat-bottom">
                  <div className="telegram-chat-preview">{preview}</div>
                  <div className="telegram-chat-status">
                    {unreadCount > 0 ? (
                      <span className="telegram-chat-unread-badge">{formatUnreadBadge(unreadCount)}</span>
                    ) : (
                      <span className="telegram-chat-read-dot" />
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </>
    );
  }

  return (
    <aside className="telegram-left-pane modern-telegram-chat-pane" aria-label="Telegram chats">
      <header className="telegram-left-header">
        <input
          ref={searchInputRef}
          className="telegram-search"
          placeholder="Search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </header>
      <section ref={listRef} className="telegram-chat-list" tabIndex={-1}>
        {content}
      </section>
    </aside>
  );
};
