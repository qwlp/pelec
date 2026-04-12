import { useId } from 'react';
import type { RefObject } from 'react';
import type { LegacyInstagramAttachment, LegacyInstagramReplyPreview } from '../../legacyBridge';

interface InstagramComposerProps {
  attachments: LegacyInstagramAttachment[];
  canSend: boolean;
  draftText: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onClearReply(): void;
  onDraftChange(value: string): void;
  onPickFiles(files: FileList | null): void;
  onRemoveAttachment(attachmentId: string): void;
  onSend(): void;
  replyPreview: LegacyInstagramReplyPreview | null;
}

export const InstagramComposer = ({
  attachments,
  canSend,
  draftText,
  inputRef,
  onClearReply,
  onDraftChange,
  onPickFiles,
  onRemoveAttachment,
  onSend,
  replyPreview,
}: InstagramComposerProps) => {
  const inputId = useId();

  return (
    <section className="modern-instagram-composer" aria-label="Instagram composer">
      {replyPreview ? (
        <div className="modern-instagram-reply-preview">
          <div>
            <strong>{replyPreview.sender}</strong>
            <span>{replyPreview.text}</span>
          </div>
          <button type="button" onClick={onClearReply}>
            Clear
          </button>
        </div>
      ) : null}
      {attachments.length ? (
        <div className="modern-instagram-attachment-list">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="modern-instagram-attachment-pill">
              <span>{attachment.name}</span>
              <button type="button" onClick={() => onRemoveAttachment(attachment.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="modern-instagram-composer-row">
        <textarea
          id="instagram-compose-input"
          ref={inputRef}
          className="modern-instagram-composer-input"
          value={draftText}
          placeholder={canSend ? 'Message' : 'Select a chat'}
          disabled={!canSend}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="modern-instagram-composer-actions">
          <label htmlFor={inputId} className={`modern-instagram-attach${canSend ? '' : ' disabled'}`}>
            Attach
          </label>
          <input
            id={inputId}
            hidden
            multiple
            type="file"
            accept="image/*,video/*"
            onChange={(event) => {
              onPickFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <button type="button" disabled={!canSend} onClick={onSend}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
};
