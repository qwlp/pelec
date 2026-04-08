import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PendingTelegramAttachment } from './media';
import type { LegacyAppBridgeApi, LegacyTelegramReplyPreview } from '../../legacyBridge';
import { formatTelegramAttachmentMeta } from './media';

interface TelegramComposerProps {
  attachments: PendingTelegramAttachment[];
  draftText: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  legacyApi: LegacyAppBridgeApi | null;
  replyPreview: LegacyTelegramReplyPreview | null;
  sendBehavior: 'enter' | 'mod-enter';
  target: HTMLElement | null;
  voiceRecorderState: 'idle' | 'recording' | 'busy' | 'unsupported';
}

export const TelegramComposer = ({
  attachments,
  draftText,
  inputRef,
  legacyApi,
  replyPreview,
  sendBehavior,
  target,
  voiceRecorderState,
}: TelegramComposerProps) => {
  const [value, setValue] = useState(draftText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const handleSend = () => {
    if (!legacyApi) {
      return;
    }
    setValue('');
    legacyApi.sendTelegramMessage();
  };

  useEffect(() => {
    setValue(draftText);
  }, [draftText]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, attachments.length, replyPreview]);

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      if (pointerIdRef.current === null) {
        return;
      }
      legacyApi?.stopTelegramVoiceRecording(event.pointerId);
      pointerIdRef.current = null;
    };

    const handleBlur = () => {
      if (pointerIdRef.current === null) {
        return;
      }
      legacyApi?.stopTelegramVoiceRecording();
      pointerIdRef.current = null;
    };

    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [legacyApi]);

  const placeholder = useMemo(() => {
    if (replyPreview) {
      return `Reply to ${replyPreview.sender}`;
    }
    if (attachments.length > 0) {
      return 'Type a caption...';
    }
    return 'Type your message here...';
  }, [attachments.length, replyPreview]);

  if (!target) {
    return null;
  }

  return createPortal(
    <div className="telegram-composer-react-shell">
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
                <img
                  className="telegram-compose-preview"
                  src={attachment.dataUrl}
                  alt={attachment.name || `Pasted image ${index + 1}`}
                />
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
        <textarea
          id="telegram-compose-input"
          ref={(node) => {
            textareaRef.current = node;
            if (!inputRef) {
              return;
            }
            inputRef.current = node;
          }}
          className="telegram-compose-input"
          placeholder={placeholder}
          rows={1}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            legacyApi?.setTelegramDraftValue(event.target.value);
          }}
          onKeyDown={(event) => {
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
          className={`telegram-voice-record-button${voiceRecorderState === 'recording' ? ' recording' : ''}`}
          disabled={voiceRecorderState === 'busy' || voiceRecorderState === 'unsupported'}
          aria-label={
            voiceRecorderState === 'recording' ? 'Release to send voice note' : 'Hold to record a voice note'
          }
          title={
            voiceRecorderState === 'recording' ? 'Release to send voice note' : 'Hold to record a voice note'
          }
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            pointerIdRef.current = event.pointerId;
            legacyApi?.startTelegramVoiceRecording(event.pointerId);
          }}
        >
          {voiceRecorderState === 'recording' ? '■' : '●'}
        </button>
        <button
          type="button"
          className="telegram-send-button"
          onClick={handleSend}
        >
          ➤
        </button>
      </div>
    </div>,
    target,
  );
};
