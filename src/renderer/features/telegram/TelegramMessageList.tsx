import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage } from '../../../shared/connectors';
import type { LegacyAppBridgeApi, LegacyRenderableTelegramMessage } from '../../legacyBridge';
import { describeTelegramCall } from './calls';
import { renderTelegramRichText } from './links';
import {
  buildVoiceBarHeights,
  formatTelegramDocumentKind,
  formatTelegramDocumentSubtitle,
  getTelegramMeaningfulAlbumCaption,
  isTelegramAlbumEligibleMessage,
  isTelegramDocumentFallbackText,
  isTelegramImageFallbackText,
  isTelegramVideoFallbackText,
} from './media';
import {
  formatDuration,
  formatFullDateTime,
  formatMessageDayLabel,
  formatMessageTimestamp,
  hasValidTimestamp,
  safeLabel,
  safeText,
} from '../../lib/format';

interface TelegramMessageListProps {
  activeChatId: string | null;
  activeChatTitle: string;
  legacyApi: LegacyAppBridgeApi | null;
  loadError: string | null;
  messages: LegacyRenderableTelegramMessage[];
  messagesLoading: boolean;
  selectedMessageId: string | null;
  target: HTMLElement | null;
}

interface MessageBundle {
  albumCaption: string;
  key: string;
  previousMessage: ChatMessage | null;
  primaryMessage: LegacyRenderableTelegramMessage;
  renderMessages: LegacyRenderableTelegramMessage[];
  shouldCollapseAlbum: boolean;
  showDayDivider: boolean;
}

const buildMessageBundles = (messages: LegacyRenderableTelegramMessage[]): MessageBundle[] => {
  const bundles: MessageBundle[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    const albumMessages = [message];
    if (isTelegramAlbumEligibleMessage(message)) {
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        const nextMessage = messages[nextIndex];
        if (
          !nextMessage ||
          nextMessage.mediaAlbumId !== message.mediaAlbumId ||
          !isTelegramAlbumEligibleMessage(nextMessage)
        ) {
          break;
        }
        albumMessages.push(nextMessage);
      }
    }

    const meaningfulAlbumCaptions = [
      ...new Set(
        albumMessages
          .map((albumMessage) => getTelegramMeaningfulAlbumCaption(albumMessage))
          .filter((value): value is string => !!value),
      ),
    ];
    const albumCaption = meaningfulAlbumCaptions[0] ?? '';
    const shouldCollapseAlbum = albumMessages.length > 1 && meaningfulAlbumCaptions.length <= 1;
    const renderMessages = shouldCollapseAlbum ? albumMessages : [message];
    const primaryMessage = renderMessages[renderMessages.length - 1] ?? message;
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const showDayDivider =
      hasValidTimestamp(primaryMessage.timestamp) &&
      (!previousMessage ||
        !hasValidTimestamp(previousMessage.timestamp) ||
        formatMessageDayLabel(previousMessage.timestamp) !== formatMessageDayLabel(primaryMessage.timestamp));

    bundles.push({
      albumCaption,
      key: primaryMessage.id,
      previousMessage,
      primaryMessage,
      renderMessages,
      shouldCollapseAlbum,
      showDayDivider,
    });

    index += renderMessages.length - 1;
  }

  return bundles;
};

const runAfterPaint = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback());
    return;
  }
  window.setTimeout(callback, 0);
};

const TELEGRAM_AUTO_SCROLL_GRACE_MS = 900;

const getTelegramMessageScrollContainer = (target: HTMLElement | null): HTMLElement | null => {
  if (!target) {
    return null;
  }

  const closest = target.closest('.telegram-message-list');
  if (closest instanceof HTMLElement) {
    return closest;
  }

  return target.parentElement instanceof HTMLElement ? target.parentElement : null;
};

const getLastTelegramMessageElement = (target: HTMLElement | null): HTMLElement | null => {
  if (!target) {
    return null;
  }

  const messages = target.querySelectorAll<HTMLElement>('[data-message-id]');
  return messages.item(messages.length - 1) ?? null;
};

const TelegramResolvedVideo = ({
  activeChatId,
  message,
}: {
  activeChatId: string | null;
  message: ChatMessage;
}) => {
  const [videoUrl, setVideoUrl] = useState(message.videoUrl ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setVideoUrl(message.videoUrl ?? '');
  }, [message.videoUrl]);

  if (videoUrl) {
    return (
      <video className="telegram-message-video" src={videoUrl} controls preload="metadata" playsInline />
    );
  }

  return (
    <button
      type="button"
      className="telegram-message-video-shell"
      disabled={loading || !activeChatId}
      onClick={async (event) => {
        event.stopPropagation();
        if (!activeChatId || loading) {
          return;
        }
        setLoading(true);
        const resolved = await window.pelec.resolveConnectorVideoUrl('telegram', activeChatId, message.id);
        setLoading(false);
        if (resolved) {
          message.videoUrl = resolved;
          setVideoUrl(resolved);
        }
      }}
    >
      {loading ? 'Loading video…' : 'Load video'}
    </button>
  );
};

const TelegramResolvedAudio = ({
  activeChatId,
  message,
}: {
  activeChatId: string | null;
  message: ChatMessage;
}) => {
  const [audioUrl, setAudioUrl] = useState(message.audioUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setAudioUrl(message.audioUrl ?? '');
  }, [message.audioUrl]);

  return (
    <TelegramVoiceNote
      activeChatId={activeChatId}
      audioUrl={audioUrl}
      loading={loading}
      message={message}
      onAudioUrlChange={setAudioUrl}
      onLoadingChange={setLoading}
      onPlayingChange={setPlaying}
      playing={playing}
    />
  );
};

const TelegramVoiceNote = ({
  activeChatId,
  audioUrl,
  loading,
  message,
  onAudioUrlChange,
  onLoadingChange,
  onPlayingChange,
  playing,
}: {
  activeChatId: string | null;
  audioUrl: string;
  loading: boolean;
  message: ChatMessage;
  onAudioUrlChange(value: string): void;
  onLoadingChange(value: boolean): void;
  onPlayingChange(value: boolean): void;
  playing: boolean;
}) => {
  const [durationLabel, setDurationLabel] = useState(formatDuration(message.audioDurationSeconds ?? 0));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setDurationLabel(formatDuration(message.audioDurationSeconds ?? 0));
  }, [message.audioDurationSeconds]);

  const waveBars = useMemo(() => buildVoiceBarHeights(message.id), [message.id]);

  return (
    <>
      <div className={`telegram-voice-note${playing ? ' playing' : ''}${loading ? ' loading' : ''}`}>
        <button
          type="button"
          className={`telegram-voice-play${playing ? ' playing' : ''}`}
          disabled={loading || !activeChatId}
          onClick={async (event) => {
            event.stopPropagation();
            const audio = audioRef.current;
            if (!audio) {
              return;
            }

            let resolvedAudioUrl = audioUrl;
            if (!resolvedAudioUrl) {
              if (!activeChatId || loading) {
                return;
              }
              onLoadingChange(true);
              const resolved = await window.pelec.resolveConnectorAudioUrl('telegram', activeChatId, message.id);
              onLoadingChange(false);
              if (!resolved) {
                setDurationLabel('retry');
                return;
              }
              message.audioUrl = resolved;
              resolvedAudioUrl = resolved;
              onAudioUrlChange(resolved);
            }

            if (!audio.paused && !audio.ended) {
              audio.pause();
              return;
            }

            if (audio.src !== resolvedAudioUrl) {
              audio.src = resolvedAudioUrl;
              audio.load();
            }

            void audio.play().catch(() => {
              onPlayingChange(false);
            });
          }}
        >
          <span className="telegram-voice-play-icon telegram-voice-play-icon-play">▶</span>
          <span className="telegram-voice-play-icon telegram-voice-play-icon-pause" aria-hidden="true" />
        </button>
        <div className="telegram-voice-wave" aria-hidden="true">
          {waveBars.map((height, index) => (
            <span key={`${message.id}:${index}`} style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="telegram-voice-duration">{durationLabel}</div>
      </div>
      <audio
        ref={audioRef}
        className="telegram-message-audio"
        preload="none"
        src={audioUrl || undefined}
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onEnded={() => onPlayingChange(false)}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration) && nextDuration > 0) {
            setDurationLabel(formatDuration(nextDuration));
          }
        }}
      />
    </>
  );
};

const TelegramCallCard = ({
  message,
}: {
  message: ChatMessage;
}) => {
  const details = describeTelegramCall(message.call, message.outgoing);

  return (
    <section
      className={`telegram-call-card ${details.tone === 'missed' ? 'is-missed' : 'is-connected'}${
        message.call?.isVideo ? ' is-video' : ''
      }`}
    >
      <div className="telegram-call-badge">{details.badge}</div>
      <div className="telegram-call-content">
        <div className="telegram-call-title">{details.title}</div>
        <div className="telegram-call-meta">{details.meta}</div>
      </div>
    </section>
  );
};

const TelegramDocumentCard = ({
  activeChatId,
  message,
}: {
  activeChatId: string | null;
  message: ChatMessage;
}) => {
  if (!message.document) {
    return null;
  }

  const fileName = safeLabel(message.document.fileName, 'Document');
  const documentKind = formatTelegramDocumentKind(fileName, message.document.mimeType);
  const documentSubtitle = formatTelegramDocumentSubtitle(
    fileName,
    message.document.mimeType,
    message.document.sizeBytes,
  );

  return (
    <section className="telegram-message-document" title={[fileName, message.document.mimeType].filter(Boolean).join('\n')}>
      <div className="telegram-message-document-main">
        <div className="telegram-message-document-icon">{documentKind}</div>
        <div className="telegram-message-document-info">
          <div className="telegram-message-document-title" title={fileName}>
            {fileName}
          </div>
          <div className="telegram-message-document-subtitle" title={message.document.mimeType}>
            {documentSubtitle}
          </div>
        </div>
      </div>
      <div className="telegram-message-document-actions">
        <button
          type="button"
          className="telegram-message-document-action"
          disabled={!activeChatId}
          onClick={async (event) => {
            event.stopPropagation();
            if (!activeChatId) {
              return;
            }
            await window.pelec.copyConnectorDocument('telegram', activeChatId, message.id);
          }}
        >
          Copy
        </button>
        <button
          type="button"
          className="telegram-message-document-action"
          disabled={!activeChatId}
          onClick={async (event) => {
            event.stopPropagation();
            if (!activeChatId) {
              return;
            }
            await window.pelec.downloadConnectorDocument('telegram', activeChatId, message.id);
          }}
        >
          Save
        </button>
      </div>
    </section>
  );
};

const TelegramMessageRow = memo(
  ({
    activeChatId,
    bundle,
    isSelected,
    legacyApi,
  }: {
    activeChatId: string | null;
    bundle: MessageBundle;
    isSelected: boolean;
    legacyApi: LegacyAppBridgeApi | null;
  }) => {
    const { albumCaption, previousMessage, primaryMessage, renderMessages, shouldCollapseAlbum, showDayDivider } =
      bundle;
    const messageTextValue = shouldCollapseAlbum ? albumCaption : safeText(primaryMessage.text);
    const messageTextTrimmed = messageTextValue.trim();
    const messageTextLower = messageTextTrimmed.toLowerCase();
    const senderLabel = safeLabel(primaryMessage.sender, primaryMessage.outgoing ? 'You' : 'Unknown');
    const isContinuation =
      !!previousMessage &&
      safeText(previousMessage.sender) === safeText(primaryMessage.sender) &&
      previousMessage.outgoing === primaryMessage.outgoing;

    const suppressImageFallbackText =
      !shouldCollapseAlbum && !!primaryMessage.imageUrl && isTelegramImageFallbackText(primaryMessage);
    const suppressVideoFallbackText =
      !shouldCollapseAlbum &&
      !!(primaryMessage.videoUrl || primaryMessage.hasVideo) &&
      isTelegramVideoFallbackText(primaryMessage);
    const suppressDocumentFallbackText =
      !shouldCollapseAlbum && isTelegramDocumentFallbackText(primaryMessage);
    const shouldRenderText =
      !!messageTextTrimmed &&
      !primaryMessage.call &&
      !suppressImageFallbackText &&
      !suppressVideoFallbackText &&
      !(primaryMessage.animationUrl && messageTextLower === 'gif/animation') &&
      !(
        primaryMessage.stickerUrl &&
        (messageTextLower === 'sticker' || messageTextLower.startsWith('sticker '))
      ) &&
      !((primaryMessage.audioUrl || primaryMessage.hasAudio) && messageTextLower === 'voice message') &&
      !suppressDocumentFallbackText;
    const isDocumentOnlyMessage =
      !!primaryMessage.document &&
      !shouldRenderText &&
      !primaryMessage.call &&
      !primaryMessage.imageUrl &&
      !primaryMessage.videoUrl &&
      !primaryMessage.hasVideo &&
      !primaryMessage.animationUrl &&
      !primaryMessage.stickerUrl &&
      !(primaryMessage.audioUrl || primaryMessage.hasAudio);

    return (
      <>
        {showDayDivider ? (
          <div className="telegram-message-day-divider" title={formatFullDateTime(primaryMessage.timestamp)}>
            {formatMessageDayLabel(primaryMessage.timestamp)}
          </div>
        ) : null}
        <article
          className={`telegram-message-item ${primaryMessage.outgoing ? 'outgoing' : 'incoming'}${
            shouldCollapseAlbum ? ' album' : ''
          }${isContinuation ? ' continuation' : ''}${isSelected ? ' selected' : ''}${
            isDocumentOnlyMessage ? ' document-only' : ''
          }`}
          data-message-id={primaryMessage.id}
          onClick={() => legacyApi?.selectTelegramMessage(primaryMessage.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            legacyApi?.openTelegramContextMenu(primaryMessage.id, event.clientX, event.clientY);
          }}
        >
          {!isContinuation ? (
            <div className="telegram-message-header">
              {primaryMessage.outgoing ? null : (
                <div className="telegram-avatar small fallback">{senderLabel.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="telegram-message-meta">{primaryMessage.outgoing ? 'You' : senderLabel}</div>
            </div>
          ) : null}
          {primaryMessage.forwardedFrom ? (
            <div className="telegram-message-forwarded">
              Forwarded from {safeLabel(primaryMessage.forwardedFrom, 'Unknown')}
            </div>
          ) : null}
          {primaryMessage.replyToSender || primaryMessage.replyToText ? (
            <div className="telegram-message-reply">
              <div className="telegram-message-reply-sender">
                {safeLabel(primaryMessage.replyToSender, 'Reply')}
              </div>
              <div className="telegram-message-reply-text">
                {safeText(primaryMessage.replyToText).trim() || '[message]'}
              </div>
            </div>
          ) : null}
          {primaryMessage.call ? <TelegramCallCard message={primaryMessage} /> : null}
          {shouldCollapseAlbum ? (
            <div className={`telegram-message-album album-size-${Math.min(renderMessages.length, 6)}`}>
              {renderMessages.map((albumMessage) =>
                albumMessage.videoUrl || albumMessage.hasVideo ? (
                  <div key={albumMessage.id} className="telegram-message-album-item is-video">
                    <TelegramResolvedVideo activeChatId={activeChatId} message={albumMessage} />
                  </div>
                ) : (
                  <button
                    key={albumMessage.id}
                    type="button"
                    className="telegram-message-album-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (albumMessage.imageUrl) {
                        legacyApi?.openTelegramImagePreview(albumMessage.imageUrl);
                      }
                    }}
                  >
                    {albumMessage.imageUrl ? (
                      <img
                        className="telegram-message-album-image"
                        src={albumMessage.imageUrl}
                        alt="Telegram image"
                        loading="lazy"
                      />
                    ) : null}
                  </button>
                ),
              )}
            </div>
          ) : primaryMessage.imageUrl ? (
            <img
              className="telegram-message-image"
              src={primaryMessage.imageUrl}
              alt="Telegram image"
              loading="lazy"
              onClick={(event) => {
                event.stopPropagation();
                legacyApi?.openTelegramImagePreview(primaryMessage.imageUrl as string);
              }}
            />
          ) : null}
          {!shouldCollapseAlbum && (primaryMessage.videoUrl || primaryMessage.hasVideo) ? (
            <TelegramResolvedVideo activeChatId={activeChatId} message={primaryMessage} />
          ) : null}
          {!shouldCollapseAlbum && (primaryMessage.audioUrl || primaryMessage.hasAudio) ? (
            <TelegramResolvedAudio activeChatId={activeChatId} message={primaryMessage} />
          ) : null}
          {primaryMessage.stickerUrl ? (
            <img
              className="telegram-message-sticker"
              src={primaryMessage.stickerUrl}
              alt={
                primaryMessage.stickerEmoji
                  ? `Telegram sticker ${primaryMessage.stickerEmoji}`
                  : 'Telegram sticker'
              }
              loading="lazy"
            />
          ) : null}
          <TelegramDocumentCard activeChatId={activeChatId} message={primaryMessage} />
          {shouldRenderText ? (
            <div className="telegram-message-text">
              {renderTelegramRichText(
                messageTextTrimmed,
                !shouldCollapseAlbum && messageTextTrimmed === safeText(primaryMessage.text).trim()
                  ? primaryMessage.textEntities
                  : undefined,
              )}
            </div>
          ) : null}
          {primaryMessage.reactions && primaryMessage.reactions.length > 0 ? (
            <div className="telegram-message-reactions">
              {primaryMessage.reactions.map((reaction) => (
                <span
                  key={`${reaction.value}:${reaction.count}`}
                  className={`telegram-message-reaction${reaction.chosen ? ' chosen' : ''}`}
                >
                  <span className="telegram-message-reaction-value">
                    {safeLabel(reaction.value, '?')}
                  </span>
                  <span className="telegram-message-reaction-count">{reaction.count}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div className="telegram-message-footer">
            <span
              className="telegram-message-time"
              title={hasValidTimestamp(primaryMessage.timestamp) ? formatFullDateTime(primaryMessage.timestamp) : ''}
            >
              {formatMessageTimestamp(primaryMessage.timestamp)}
            </span>
            {primaryMessage.outgoing ? (
              <span
                className={`telegram-message-receipt ${
                  primaryMessage.pendingState === 'sending'
                    ? 'sending'
                    : primaryMessage.readByPeer
                      ? 'read'
                      : 'sent'
                }`}
                title={
                  primaryMessage.pendingState === 'sending'
                    ? 'Sending'
                    : primaryMessage.readByPeer
                      ? 'Read'
                      : 'Sent'
                }
              >
                {primaryMessage.pendingState === 'sending' ? (
                  <span className="telegram-message-spinner" aria-hidden="true" />
                ) : (
                  <>
                    <span className="telegram-message-tick">✓</span>
                    {primaryMessage.readByPeer ? <span className="telegram-message-tick">✓</span> : null}
                  </>
                )}
              </span>
            ) : null}
          </div>
        </article>
      </>
    );
  },
  (previous, next) =>
    previous.bundle === next.bundle &&
    previous.isSelected === next.isSelected &&
    previous.activeChatId === next.activeChatId &&
    previous.legacyApi === next.legacyApi,
);

export const TelegramMessageList = ({
  activeChatId,
  activeChatTitle,
  legacyApi,
  loadError,
  messages,
  messagesLoading,
  selectedMessageId,
  target,
}: TelegramMessageListProps) => {
  const bundles = useMemo(() => buildMessageBundles(messages), [messages]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const pendingAutoScrollRef = useRef<string | null>(null);
  const latestScrollFollowupTimerRef = useRef<number | null>(null);
  const previousMessagesLoadingRef = useRef(messagesLoading);
  const previousActiveChatIdRef = useRef(activeChatId);
  const autoScrollGraceRef = useRef<{ chatId: string | null; expiresAt: number }>({
    chatId: null,
    expiresAt: 0,
  });
  const programmaticScrollRef = useRef(false);

  useEffect(() => {
    return () => {
      if (latestScrollFollowupTimerRef.current !== null) {
        window.clearTimeout(latestScrollFollowupTimerRef.current);
      }
    };
  }, []);

  const scrollToLatestMessage = (behavior: ScrollBehavior): void => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer) {
      return;
    }

    programmaticScrollRef.current = true;

    const syncToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    };

    const latestMessage = getLastTelegramMessageElement(target);
    if (latestMessage?.scrollIntoView) {
      latestMessage.scrollIntoView({
        block: 'end',
        inline: 'nearest',
        behavior,
      });
    } else if (typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior,
      });
    } else {
      syncToBottom();
    }

    syncToBottom();
    if (latestScrollFollowupTimerRef.current !== null) {
      window.clearTimeout(latestScrollFollowupTimerRef.current);
    }
    latestScrollFollowupTimerRef.current = window.setTimeout(() => {
      latestScrollFollowupTimerRef.current = null;
      syncToBottom();
      programmaticScrollRef.current = false;
    }, 120);
  };

  const armAutoScrollGrace = (chatId: string | null): void => {
    autoScrollGraceRef.current = {
      chatId,
      expiresAt: Date.now() + TELEGRAM_AUTO_SCROLL_GRACE_MS,
    };
  };

  const shouldKeepAutoScrolling = (chatId: string | null): boolean => {
    if (!chatId) {
      return false;
    }

    const { chatId: armedChatId, expiresAt } = autoScrollGraceRef.current;
    if (armedChatId !== chatId) {
      return false;
    }

    if (Date.now() > expiresAt) {
      autoScrollGraceRef.current = {
        chatId: null,
        expiresAt: 0,
      };
      return false;
    }

    return true;
  };

  useEffect(() => {
    if (!target || !selectedMessageId) {
      return;
    }
    if (previousActiveChatIdRef.current !== activeChatId) {
      return;
    }
    const selected = target.querySelector<HTMLElement>(`[data-message-id="${selectedMessageId}"]`);
    selected?.scrollIntoView?.({ block: 'nearest' });
  }, [activeChatId, selectedMessageId, target]);

  useEffect(() => {
    pendingAutoScrollRef.current = activeChatId;
    armAutoScrollGrace(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    previousActiveChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (messagesLoading && !previousMessagesLoadingRef.current) {
      pendingAutoScrollRef.current = activeChatId;
      armAutoScrollGrace(activeChatId);
    }
    previousMessagesLoadingRef.current = messagesLoading;
  }, [activeChatId, messagesLoading]);

  useEffect(() => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer) {
      setShowJumpToLatest(false);
      return;
    }

    const updateJumpState = () => {
      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (distanceFromBottom > 120 && !programmaticScrollRef.current) {
        autoScrollGraceRef.current = {
          chatId: null,
          expiresAt: 0,
        };
      }
      setShowJumpToLatest(distanceFromBottom > 120);
    };

    updateJumpState();
    scrollContainer.addEventListener('scroll', updateJumpState, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', updateJumpState);
    };
  }, [target, activeChatId, bundles.length, messagesLoading]);

  useEffect(() => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer || !activeChatId || messagesLoading) {
      return;
    }
    if (pendingAutoScrollRef.current !== activeChatId && !shouldKeepAutoScrolling(activeChatId)) {
      return;
    }

    pendingAutoScrollRef.current = null;
    runAfterPaint(() => {
      scrollToLatestMessage('auto');
      setShowJumpToLatest(false);
    });
  }, [activeChatId, messagesLoading, bundles.length, target]);

  useEffect(() => {
    if (!target || !legacyApi) {
      return;
    }

    const activateMessagesPane = () => {
      legacyApi.activateTelegramMessagesPane();
    };

    target.addEventListener('mousedown', activateMessagesPane);
    target.addEventListener('focusin', activateMessagesPane);
    return () => {
      target.removeEventListener('mousedown', activateMessagesPane);
      target.removeEventListener('focusin', activateMessagesPane);
    };
  }, [legacyApi, target]);

  if (!target) {
    return null;
  }

  const scrollContainer = getTelegramMessageScrollContainer(target);

  return (
    <>
      {createPortal(
        <>
          {messagesLoading ? <div className="telegram-empty">Loading messages...</div> : null}
          {!messagesLoading && loadError ? <div className="telegram-empty">{loadError}</div> : null}
          {!messagesLoading && !loadError && bundles.length < 1 ? (
            <div className="telegram-empty">No messages in {activeChatTitle || 'this chat'}.</div>
          ) : null}
          {!messagesLoading && !loadError
            ? bundles.map((bundle) => (
                <TelegramMessageRow
                  key={bundle.key}
                  activeChatId={activeChatId}
                  bundle={bundle}
                  isSelected={selectedMessageId === bundle.primaryMessage.id}
                  legacyApi={legacyApi}
                />
              ))
            : null}
        </>,
        target,
      )}
      {scrollContainer && showJumpToLatest
        ? createPortal(
            <button
              type="button"
              className="telegram-jump-latest-button"
              onClick={() => {
                scrollToLatestMessage('smooth');
                setShowJumpToLatest(false);
              }}
            >
              Jump to latest
            </button>,
            scrollContainer,
          )
        : null}
    </>
  );
};
