import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PendingTelegramAttachment } from './media';
import type { LegacyAppBridgeApi, LegacyTelegramReplyPreview } from '../../legacyBridge';
import { formatTelegramAttachmentMeta } from './media';

interface TelegramComposerProps {
  attachments: PendingTelegramAttachment[];
  canSend: boolean;
  draftText: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  legacyApi: LegacyAppBridgeApi | null;
  replyPreview: LegacyTelegramReplyPreview | null;
  sendBehavior: 'enter' | 'mod-enter';
  target: HTMLElement | null;
  voiceRecorderState: 'idle' | 'preparing' | 'recording' | 'sending' | 'unsupported';
}

const formatRecordingDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const TelegramComposer = ({
  attachments,
  canSend,
  draftText,
  inputRef,
  legacyApi,
  replyPreview,
  sendBehavior,
  target,
  voiceRecorderState,
}: TelegramComposerProps) => {
  const [value, setValue] = useState(draftText);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [dragDepth, setDragDepth] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          disabled={composeLocked}
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
          className="telegram-send-button"
          disabled={composeLocked}
          onClick={handleSend}
        >
          ➤
        </button>
      </div>
    </div>,
    target,
  );
};
