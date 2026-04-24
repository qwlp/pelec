import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PendingTelegramAttachment } from './media';
import type { LegacyAppBridgeApi, LegacyTelegramReplyPreview } from '../../legacyBridge';
import {
  buildTelegramEmojiSuggestions,
  getTelegramEmojiTokenMatch,
  type TelegramEmojiSuggestion,
} from '../../lib/emoji';
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

type TelegramEmojiCompletionState = {
  activeIndex: number;
  suggestions: TelegramEmojiSuggestion[];
  tokenEnd: number;
  tokenStart: number;
};

const TELEGRAM_COMPOSER_HEIGHT_PX = 48;

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
  const [emojiCompletion, setEmojiCompletion] = useState<TelegramEmojiCompletionState | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [dragDepth, setDragDepth] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSelectionRef = useRef<{ end: number; start: number } | null>(null);

  const syncDraftValue = (nextValue: string) => {
    setValue(nextValue);
    legacyApi?.setTelegramDraftValue(nextValue);
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
    textareaRef.current?.focus();
    return true;
  };

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

    textarea.style.height = `${TELEGRAM_COMPOSER_HEIGHT_PX}px`;
    textarea.style.overflowY = 'auto';
    if (pendingSelectionRef.current) {
      textarea.setSelectionRange(
        pendingSelectionRef.current.start,
        pendingSelectionRef.current.end,
      );
      pendingSelectionRef.current = null;
    }
  }, [value, attachments.length, replyPreview]);

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
          aria-autocomplete="list"
          aria-controls={emojiCompletion ? 'telegram-emoji-completion' : undefined}
          aria-expanded={emojiCompletion ? 'true' : 'false'}
          aria-activedescendant={
            emojiCompletion
              ? `telegram-emoji-completion-item-${emojiCompletion.activeIndex}`
              : undefined
          }
          onChange={(event) => {
            syncDraftValue(event.target.value);
            updateEmojiCompletion(
              event.target.value,
              event.target.selectionStart,
              event.target.selectionEnd,
            );
          }}
          onFocus={(event) => {
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onBlur={() => {
            setEmojiCompletion(null);
          }}
          onClick={(event) => {
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onPaste={(event) => {
            const files = getClipboardFiles(event.clipboardData);
            if (files.length < 1) {
              return;
            }

            event.preventDefault();
            legacyApi?.appendTelegramFiles(files);
          }}
          onSelect={(event) => {
            updateEmojiCompletion(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            );
          }}
          onKeyDown={(event) => {
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
