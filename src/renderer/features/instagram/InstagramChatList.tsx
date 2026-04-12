import type { RefObject } from 'react';
import { formatChatTimestamp, safeLabel } from '../../lib/format';
import type { ChatSummary } from '../../../shared/connectors';

interface InstagramChatListProps {
  activeChatId: string | null;
  chats: ChatSummary[];
  listRef: RefObject<HTMLDivElement | null>;
  loadError: string | null;
  loading: boolean;
  onRefresh(): void;
  onSearchQueryChange(query: string): void;
  onSelectChat(chatId: string): void;
  onStartAuth(): void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedChatId: string | null;
}

export const InstagramChatList = ({
  activeChatId,
  chats,
  listRef,
  loadError,
  loading,
  onRefresh,
  onSearchQueryChange,
  onSelectChat,
  onStartAuth,
  searchInputRef,
  searchQuery,
  selectedChatId,
}: InstagramChatListProps) => {
  return (
    <aside className="modern-instagram-chat-pane" aria-label="Instagram chats">
      <header className="modern-instagram-pane-header">
        <div>
          <h2>Chats</h2>
          <p>{loading ? 'Loading…' : `${chats.length} conversation${chats.length === 1 ? '' : 's'}`}</p>
        </div>
        <div className="modern-instagram-pane-actions">
          <button type="button" onClick={onStartAuth}>
            Auth
          </button>
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </header>
      <div className="modern-instagram-search-shell">
        <input
          ref={searchInputRef}
          className="modern-instagram-search"
          type="text"
          value={searchQuery}
          placeholder="Filter chats"
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </div>
      {loadError ? <div className="modern-instagram-state modern-instagram-error">{loadError}</div> : null}
      {!loadError && chats.length < 1 && !loading ? (
        <div className="modern-instagram-state">No chats available.</div>
      ) : null}
      <div ref={listRef} className="modern-instagram-chat-list" id="instagram-chat-list" tabIndex={-1}>
        {chats.map((chat) => {
          const isSelected = chat.id === selectedChatId;
          const isActive = chat.id === activeChatId;
          return (
            <button
              key={chat.id}
              type="button"
              className={`modern-instagram-chat-item${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
              onClick={() => onSelectChat(chat.id)}
            >
              <div className="modern-instagram-chat-title-row">
                <span className="modern-instagram-chat-title">{safeLabel(chat.title, 'Instagram chat')}</span>
                <span className="modern-instagram-chat-time">
                  {chat.lastMessageTimestamp ? formatChatTimestamp(chat.lastMessageTimestamp) : ''}
                </span>
              </div>
              <div className="modern-instagram-chat-preview">
                {chat.lastMessageSender ? `${chat.lastMessageSender}: ` : ''}
                {safeLabel(chat.lastMessagePreview, 'No messages yet')}
              </div>
              {chat.unreadCount > 0 ? (
                <span className="modern-instagram-chat-unread">{chat.unreadCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
};
