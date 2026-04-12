import { formatMessageTimestamp, safeLabel, safeText } from '../../lib/format';
import type { ChatMessage } from '../../../shared/connectors';

interface InstagramMessageListProps {
  activeChatId: string | null;
  activeChatTitle: string;
  loadError: string | null;
  messages: ChatMessage[];
  messagesLoading: boolean;
  onBackToChats?(): void;
  selectedMessageId: string | null;
}

export const InstagramMessageList = ({
  activeChatId,
  activeChatTitle,
  loadError,
  messages,
  messagesLoading,
  onBackToChats,
  selectedMessageId,
}: InstagramMessageListProps) => {
  return (
    <section className="modern-instagram-message-pane" aria-label="Instagram messages">
      <header className="modern-instagram-message-header">
        <div>
          {onBackToChats ? (
            <button type="button" className="modern-instagram-back" onClick={onBackToChats}>
              Back
            </button>
          ) : null}
          <h2>{safeLabel(activeChatTitle, 'Messages')}</h2>
        </div>
      </header>
      {!activeChatId ? <div className="modern-instagram-state">Select a chat to view messages.</div> : null}
      {loadError ? <div className="modern-instagram-state modern-instagram-error">{loadError}</div> : null}
      {messagesLoading && !loadError ? <div className="modern-instagram-state">Loading messages…</div> : null}
      <div className="modern-instagram-message-list" id="instagram-message-list" tabIndex={-1}>
        {messages.map((message) => (
          <article
            key={message.id}
            className={`modern-instagram-message${message.id === selectedMessageId ? ' selected' : ''}${message.outgoing ? ' outgoing' : ''}`}
          >
            <div className="modern-instagram-message-meta">
              <span>{safeLabel(message.sender, 'Instagram')}</span>
              <span>{formatMessageTimestamp(message.timestamp)}</span>
            </div>
            {message.replyToMessageId ? (
              <div className="modern-instagram-reply-block">
                <strong>{safeLabel(message.replyToSender, 'Reply')}</strong>
                <span>{safeLabel(message.replyToText, 'Original message unavailable.')}</span>
              </div>
            ) : null}
            {message.text ? <p className="modern-instagram-message-text">{safeText(message.text)}</p> : null}
            {message.imageUrl ? (
              <img className="modern-instagram-media" src={message.imageUrl} alt="Instagram media" />
            ) : null}
            {message.videoUrl ? (
              <video className="modern-instagram-media" src={message.videoUrl} controls playsInline />
            ) : null}
            {message.reactions?.length ? (
              <div className="modern-instagram-reactions">
                {message.reactions.map((reaction) => (
                  <span key={`${message.id}:${reaction.value}`} className="modern-instagram-reaction">
                    {reaction.value} {reaction.count}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
};
