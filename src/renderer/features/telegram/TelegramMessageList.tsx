import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage } from '../../../shared/connectors';
import type { LegacyAppBridgeApi, LegacyRenderableTelegramMessage } from '../../legacyBridge';
import { describeTelegramCall } from './calls';
import { renderTelegramRichText } from './links';
import {
  buildVoiceBarHeights,
  extractLocalMediaPath,
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
  formatFileSize,
  formatFullDateTime,
  formatMessageDayLabel,
  formatMessageTimestamp,
  hasValidTimestamp,
  safeLabel,
  safeText,
} from '../../lib/format';
import { getTelegramMessageRenderSignature } from './messageRender';

interface TelegramMessageListProps {
  activeChatId: string | null;
  activeChatTitle: string;
  canDropFiles?: boolean;
  hasOlderMessages?: boolean;
  legacyApi: LegacyAppBridgeApi | null;
  loadError: string | null;
  loadingOlderMessages?: boolean;
  messages: LegacyRenderableTelegramMessage[];
  messagesLoading: boolean;
  messageTextSelectable?: boolean;
  onBackToChats?: () => void;
  selectedMessageId: string | null;
  target: HTMLElement | null;
}

interface MessageBundle {
  albumCaption: string;
  key: string;
  previousMessage: ChatMessage | null;
  primaryMessage: LegacyRenderableTelegramMessage;
  renderMessages: LegacyRenderableTelegramMessage[];
  renderSignature: string;
  shouldCollapseAlbum: boolean;
  showDayDivider: boolean;
}

interface TelegramVoicePlaybackCoordinator {
  activate(audio: HTMLAudioElement): void;
  beginRequest(): number;
  isCurrentRequest(requestId: number): boolean;
  release(audio: HTMLAudioElement): void;
  stopActive(): void;
}

const TELEGRAM_VOICE_PLAYBACK_RATES = [1, 1.5, 2] as const;
const TELEGRAM_POLL_COUNT_FORMATTER = new Intl.NumberFormat();
const TELEGRAM_MAX_RENDERED_TEXT_LENGTH = 5_000;

const formatTelegramVoicePlaybackRate = (rate: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]): string =>
  `${Number.isInteger(rate) ? rate.toFixed(0) : rate}x`;

const formatTelegramPollCount = (count: number): string => TELEGRAM_POLL_COUNT_FORMATTER.format(count);

const limitTelegramRenderedText = (
  value: string,
): { text: string; truncated: boolean; originalLength: number } => {
  if (value.length <= TELEGRAM_MAX_RENDERED_TEXT_LENGTH) {
    return { text: value, truncated: false, originalLength: value.length };
  }
  return {
    text: `${value.slice(0, TELEGRAM_MAX_RENDERED_TEXT_LENGTH)}\n\n[Message truncated by Pelec]`,
    truncated: true,
    originalLength: value.length,
  };
};

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
      renderSignature: getTelegramMessageRenderSignature({
        albumCaption,
        previousMessage,
        primaryMessage,
        renderMessages,
        shouldCollapseAlbum,
      }),
      shouldCollapseAlbum,
      showDayDivider,
    });

    index += renderMessages.length - 1;
  }

  return bundles;
};

const useStableMessageBundles = (
  messages: LegacyRenderableTelegramMessage[],
): MessageBundle[] => {
  const bundleCacheRef = useRef<Map<string, MessageBundle>>(new Map());

  return useMemo(() => {
    const nextBundles = buildMessageBundles(messages);
    const nextBundleCache = new Map<string, MessageBundle>();
    const stableBundles = nextBundles.map((bundle) => {
      const cached = bundleCacheRef.current.get(bundle.key);
      const nextBundle =
        cached && cached.renderSignature === bundle.renderSignature ? cached : bundle;
      nextBundleCache.set(bundle.key, nextBundle);
      return nextBundle;
    });

    bundleCacheRef.current = nextBundleCache;
    return stableBundles;
  }, [messages]);
};

const runAfterPaint = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback());
    return;
  }
  window.setTimeout(callback, 0);
};

const scheduleTelegramAnimationFrame = (callback: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
};

const cancelTelegramAnimationFrame = (frameId: number): void => {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frameId);
    return;
  }
  window.clearTimeout(frameId);
};

const TELEGRAM_AUTO_SCROLL_GRACE_MS = 900;

const TELEGRAM_JUMP_LATEST_OFFSET_PX = 16;

const TELEGRAM_LATEST_PROXIMITY_PX = 120;

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

const getTelegramMessageDistanceFromBottom = (scrollContainer: HTMLElement): number =>
  scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;

const isTelegramMessageInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as Element).closest !== 'function') {
    return false;
  }

  const element = target as Element;
  return Boolean(
    element.closest(
      [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '.telegram-message-image',
        '.telegram-message-album-item',
        '.telegram-message-album-image',
        '.telegram-message-video',
        '.telegram-message-animation',
        '.telegram-message-sticker',
        '.telegram-deferred-image',
      ].join(', '),
    ),
  );
};

const hasSelectionInsideElement = (element: HTMLElement): boolean => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.intersectsNode(element)) {
      return true;
    }
  }

  return false;
};

const getSelectedTextInsideElement = (element: HTMLElement): string => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return '';
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.intersectsNode(element)) {
      return selection.toString();
    }
  }

  return '';
};

const copySelectedTextInsideElement = async (element: HTMLElement): Promise<boolean> => {
  const selectedText = getSelectedTextInsideElement(element).trim();
  if (!selectedText) {
    return false;
  }

  try {
    if (await window.pelec.copyTextToClipboard(selectedText)) {
      return true;
    }
  } catch {
    // Fall through to the browser clipboard API for test and browser-like contexts.
  }

  if (!window.navigator?.clipboard?.writeText) {
    return false;
  }

  try {
    await window.navigator.clipboard.writeText(selectedText);
    return true;
  } catch {
    return false;
  }
};

const isSelectableMessageTextTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  !!target.closest(
    '.telegram-message-text, .telegram-message-forwarded, .telegram-message-reply-text',
  );

const TelegramResolvedVideo = ({
  activeChatId,
  message,
  variant = 'single',
}: {
  activeChatId: string | null;
  message: ChatMessage;
  variant?: 'album' | 'single';
}) => {
  type TelegramVideoPlaybackState =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'failed-download'
    | 'failed-decode';

  const [videoUrl, setVideoUrl] = useState(message.videoUrl ?? '');
  const [playbackState, setPlaybackState] = useState<TelegramVideoPlaybackState>(
    message.videoUrl ? 'ready' : 'idle',
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingPlayRef = useRef(false);
  const playbackStateRef = useRef<TelegramVideoPlaybackState>(message.videoUrl ? 'ready' : 'idle');

  const shellClassName =
    variant === 'album' ? 'telegram-message-album-video-shell' : 'telegram-message-video-shell';
  const videoClassName = variant === 'album' ? 'telegram-message-album-video' : 'telegram-message-video';
  const label = 'Telegram video';
  const videoAspectRatio =
    message.videoWidth && message.videoHeight && message.videoWidth > 0 && message.videoHeight > 0
      ? `${message.videoWidth} / ${message.videoHeight}`
      : undefined;

  const setNextPlaybackState = (nextState: TelegramVideoPlaybackState): void => {
    playbackStateRef.current = nextState;
    setPlaybackState(nextState);
  };

  useEffect(() => {
    setVideoUrl(message.videoUrl ?? '');
    playbackStateRef.current = message.videoUrl ? 'ready' : 'idle';
    setPlaybackState(message.videoUrl ? 'ready' : 'idle');
  }, [message.videoUrl]);

  useEffect(() => {
    pendingPlayRef.current = false;
    setVideoUrl(message.videoUrl ?? '');
    playbackStateRef.current = message.videoUrl ? 'ready' : 'idle';
    setPlaybackState(message.videoUrl ? 'ready' : 'idle');
  }, [message.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!videoUrl || !video) {
      return;
    }

    video.load();
    if (!pendingPlayRef.current) {
      return;
    }

    pendingPlayRef.current = false;
    void video.play().catch(() => {
      // Keep controls visible if autoplay is blocked after explicit click.
    });
  }, [videoUrl]);

  const failDecode = (): void => {
    pendingPlayRef.current = false;
    setNextPlaybackState('failed-decode');
  };

  if (videoUrl && playbackState !== 'failed-decode') {
    return (
      <div className={`${shellClassName} loaded`}>
        <video
          ref={videoRef}
          className={videoClassName}
          controls
          preload="metadata"
          playsInline
          aria-label={label}
          onPlay={() => setNextPlaybackState('ready')}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth < 1 || video.videoHeight < 1) {
              failDecode();
              return;
            }
            setNextPlaybackState('ready');
          }}
          onCanPlay={(event) => {
            const video = event.currentTarget;
            const haveMetadata = window.HTMLMediaElement?.HAVE_METADATA ?? 1;
            if (
              video.readyState >= haveMetadata &&
              (video.videoWidth < 1 || video.videoHeight < 1)
            ) {
              failDecode();
            }
          }}
          onError={() => {
            failDecode();
          }}
          onStalled={(event) => {
            const noSource = window.HTMLMediaElement?.NETWORK_NO_SOURCE ?? 3;
            if (event.currentTarget.networkState === noSource) {
              failDecode();
            }
          }}
          onAbort={() => {
            if (playbackStateRef.current === 'ready') {
              failDecode();
            }
          }}
        >
          <source
            src={videoUrl}
            type={message.videoMimeType && message.videoMimeType !== 'video/quicktime' ? message.videoMimeType : undefined}
          />
        </video>
      </div>
    );
  }

  const shellStateClassName =
    playbackState === 'loading' ? ' loading' : playbackState.startsWith('failed') ? ' failed' : '';
  const triggerLabel =
    playbackState === 'loading'
      ? 'Loading video…'
      : playbackState === 'failed-decode'
        ? 'Open video externally'
        : playbackState === 'failed-download'
          ? 'Retry video'
          : 'Load video';

  return (
    <div
      className={`${shellClassName}${shellStateClassName}`}
      style={variant === 'single' && videoAspectRatio ? { aspectRatio: videoAspectRatio } : undefined}
    >
      <button
        type="button"
        className={`telegram-message-video-trigger${message.videoThumbnailUrl ? ' has-thumbnail' : ''}`}
        disabled={playbackState === 'loading' || !activeChatId}
        onClick={async (event) => {
          event.stopPropagation();
          if (playbackState === 'failed-decode') {
            const localPath = videoUrl ? extractLocalMediaPath(videoUrl) : undefined;
            if (!localPath) {
              setNextPlaybackState('failed-download');
              return;
            }
            await window.pelec.openPath(localPath);
            return;
          }

          if (!activeChatId || playbackState === 'loading') {
            return;
          }

          pendingPlayRef.current = true;
          setNextPlaybackState('loading');
          const resolved = await window.pelec.resolveConnectorVideoUrl('telegram', activeChatId, message.id);
          if (!resolved) {
            pendingPlayRef.current = false;
            setNextPlaybackState('failed-download');
            return;
          }

          message.videoUrl = resolved;
          setVideoUrl(resolved);
          setNextPlaybackState('ready');
        }}
      >
        {message.videoThumbnailUrl ? (
          <img
            className="telegram-message-video-thumbnail"
            src={message.videoThumbnailUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        ) : null}
        <span className="telegram-message-video-trigger-overlay" aria-hidden="true" />
        <span className="telegram-message-video-trigger-icon">
          {playbackState === 'failed-decode' ? '!' : '▶'}
        </span>
        <span className="telegram-message-video-trigger-text">{triggerLabel}</span>
      </button>
    </div>
  );
};

const TelegramResolvedAudio = ({
  activeChatId,
  message,
  playbackCoordinator,
  playbackRate,
  onPlaybackRateChange,
}: {
  activeChatId: string | null;
  message: ChatMessage;
  playbackCoordinator: TelegramVoicePlaybackCoordinator;
  playbackRate: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number];
  onPlaybackRateChange(value: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]): void;
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
      playbackCoordinator={playbackCoordinator}
      playbackRate={playbackRate}
      onPlaybackRateChange={onPlaybackRateChange}
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
  playbackCoordinator,
  playbackRate,
  onPlaybackRateChange,
}: {
  activeChatId: string | null;
  audioUrl: string;
  loading: boolean;
  message: ChatMessage;
  onAudioUrlChange(value: string): void;
  onLoadingChange(value: boolean): void;
  onPlayingChange(value: boolean): void;
  playing: boolean;
  playbackCoordinator: TelegramVoicePlaybackCoordinator;
  playbackRate: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number];
  onPlaybackRateChange(value: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]): void;
}) => {
  const [durationSeconds, setDurationSeconds] = useState(message.audioDurationSeconds ?? 0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationLabelOverride, setDurationLabelOverride] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingPlayRequestRef = useRef<number | null>(null);
  const pendingSeekFractionRef = useRef<number | null>(null);
  const progressFrameRef = useRef<number | null>(null);

  const effectiveDurationSeconds = durationSeconds > 0 ? durationSeconds : (message.audioDurationSeconds ?? 0);

  const applyPendingSeek = (): void => {
    const audio = audioRef.current;
    const pendingSeekFraction = pendingSeekFractionRef.current;
    if (!audio || pendingSeekFraction === null) {
      return;
    }

    const seekDuration =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : effectiveDurationSeconds;
    if (!(seekDuration > 0)) {
      return;
    }

    const nextCurrentTime = Math.min(seekDuration, Math.max(0, pendingSeekFraction * seekDuration));
    pendingSeekFractionRef.current = null;
    audio.currentTime = nextCurrentTime;
    setCurrentTimeSeconds(nextCurrentTime);
  };

  const syncCurrentTimeFromAudio = (): void => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextCurrentTime = audio.currentTime;
    if (Number.isFinite(nextCurrentTime) && nextCurrentTime >= 0) {
      setCurrentTimeSeconds((currentTime) =>
        Math.abs(currentTime - nextCurrentTime) < 0.01 ? currentTime : nextCurrentTime,
      );
    }
  };

  const stopProgressLoop = (): void => {
    if (progressFrameRef.current !== null) {
      cancelTelegramAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
  };

  const startProgressLoop = (): void => {
    stopProgressLoop();

    const tick = (): void => {
      syncCurrentTimeFromAudio();
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) {
        progressFrameRef.current = null;
        return;
      }
      progressFrameRef.current = scheduleTelegramAnimationFrame(() => tick());
    };

    tick();
  };

  useEffect(() => {
    setDurationSeconds(message.audioDurationSeconds ?? 0);
    setCurrentTimeSeconds(0);
    setDurationLabelOverride(null);
    pendingSeekFractionRef.current = null;
    stopProgressLoop();
  }, [message.audioDurationSeconds, message.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) {
      return;
    }

    audio.load();
    const pendingPlayRequest = pendingPlayRequestRef.current;
    if (
      pendingPlayRequest === null ||
      !playbackCoordinator.isCurrentRequest(pendingPlayRequest)
    ) {
      pendingPlayRequestRef.current = null;
      return;
    }

    pendingPlayRequestRef.current = null;
    playbackCoordinator.activate(audio);
    void audio.play().catch(() => {
      onPlayingChange(false);
    });
  }, [audioUrl, onPlayingChange, playbackCoordinator]);

  useEffect(() => {
    pendingPlayRequestRef.current = null;
    pendingSeekFractionRef.current = null;
    stopProgressLoop();
  }, [activeChatId, message.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = playbackRate;
  }, [playbackRate, audioUrl, message.id]);

  useEffect(() => {
    return () => {
      pendingPlayRequestRef.current = null;
      pendingSeekFractionRef.current = null;
      stopProgressLoop();
      const audio = audioRef.current;
      if (audio) {
        playbackCoordinator.release(audio);
      }
    };
  }, [playbackCoordinator]);

  const waveBars = useMemo(() => buildVoiceBarHeights(message.id), [message.id]);
  const progress =
    effectiveDurationSeconds > 0 ? Math.min(1, currentTimeSeconds / effectiveDurationSeconds) : 0;
  const activeBarCount =
    effectiveDurationSeconds > 0
      ? Math.min(
          waveBars.length,
          Math.max(playing || currentTimeSeconds > 0 ? 1 : 0, Math.ceil(progress * waveBars.length)),
        )
      : 0;
  const playheadBarIndex = activeBarCount > 0 ? Math.min(waveBars.length - 1, activeBarCount - 1) : -1;
  const durationLabel =
    durationLabelOverride ??
    `${formatDuration(currentTimeSeconds)} / ${formatDuration(effectiveDurationSeconds)}`;

  const seekToFraction = async (fraction: number): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextFraction = Math.min(1, Math.max(0, fraction));
    pendingSeekFractionRef.current = nextFraction;

    if (!audioUrl) {
      if (!activeChatId || loading) {
        pendingSeekFractionRef.current = null;
        return;
      }

      pendingPlayRequestRef.current = null;
      onLoadingChange(true);
      const resolved = await window.pelec.resolveConnectorAudioUrl('telegram', activeChatId, message.id);
      onLoadingChange(false);
      if (!resolved) {
        pendingSeekFractionRef.current = null;
        setDurationLabelOverride('retry');
        return;
      }

      setDurationLabelOverride(null);
      message.audioUrl = resolved;
      onAudioUrlChange(resolved);
      return;
    }

    applyPendingSeek();
    syncCurrentTimeFromAudio();
  };

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

            if (!audio.paused && !audio.ended) {
              pendingPlayRequestRef.current = null;
              audio.pause();
              return;
            }

            if (!audioUrl) {
              if (!activeChatId || loading) {
                return;
              }
              pendingPlayRequestRef.current = playbackCoordinator.beginRequest();
              onLoadingChange(true);
              const resolved = await window.pelec.resolveConnectorAudioUrl('telegram', activeChatId, message.id);
              onLoadingChange(false);
              if (!resolved) {
                pendingPlayRequestRef.current = null;
                setDurationLabelOverride('retry');
                return;
              }
              setDurationLabelOverride(null);
              message.audioUrl = resolved;
              onAudioUrlChange(resolved);
              return;
            }

            if (audio.ended) {
              audio.currentTime = 0;
              setCurrentTimeSeconds(0);
            }

            pendingPlayRequestRef.current = null;
            playbackCoordinator.beginRequest();
            playbackCoordinator.activate(audio);
            void audio.play().catch(() => {
              onPlayingChange(false);
            });
          }}
        >
          <span className="telegram-voice-play-icon telegram-voice-play-icon-play">▶</span>
          <span className="telegram-voice-play-icon telegram-voice-play-icon-pause" aria-hidden="true" />
        </button>
        <div className="telegram-voice-main">
          <button
            type="button"
            className="telegram-voice-wave"
            disabled={loading || (!audioUrl && !activeChatId)}
            aria-label={`Seek voice note. ${durationLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              if (bounds.width <= 0) {
                return;
              }
              const ratio = (event.clientX - bounds.left) / bounds.width;
              void seekToFraction(ratio);
            }}
          >
            {waveBars.map((height, index) => (
              <span
                key={`${message.id}:${index}`}
                className={`telegram-voice-wave-bar${index < activeBarCount ? ' is-played' : ''}${
                  index === playheadBarIndex ? ' is-current' : ''
                }`}
                style={{ height: `${height}%` }}
              />
            ))}
          </button>
          <div className="telegram-voice-meta">
            <div className="telegram-voice-duration">{durationLabel}</div>
            <div className="telegram-voice-rate-group" role="group" aria-label="Voice note speed">
              {TELEGRAM_VOICE_PLAYBACK_RATES.map((rate) => {
                const label = formatTelegramVoicePlaybackRate(rate);
                return (
                  <button
                    key={rate}
                    type="button"
                    className="telegram-voice-rate"
                    aria-label={`Playback speed ${label}`}
                    aria-pressed={playbackRate === rate}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlaybackRateChange(rate);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <audio
        ref={audioRef}
        className="telegram-message-audio"
        preload="none"
        src={audioUrl || undefined}
        onPlay={(event) => {
          playbackCoordinator.activate(event.currentTarget);
          syncCurrentTimeFromAudio();
          startProgressLoop();
          onPlayingChange(true);
        }}
        onPause={(event) => {
          stopProgressLoop();
          syncCurrentTimeFromAudio();
          playbackCoordinator.release(event.currentTarget);
          onPlayingChange(false);
        }}
        onEnded={(event) => {
          stopProgressLoop();
          playbackCoordinator.release(event.currentTarget);
          onPlayingChange(false);
          setCurrentTimeSeconds(0);
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration) && nextDuration > 0) {
            setDurationSeconds(nextDuration);
            setDurationLabelOverride(null);
          }
          event.currentTarget.playbackRate = playbackRate;
          applyPendingSeek();
          syncCurrentTimeFromAudio();
        }}
        onTimeUpdate={(event) => {
          const nextCurrentTime = event.currentTarget.currentTime;
          if (Number.isFinite(nextCurrentTime) && nextCurrentTime >= 0) {
            setCurrentTimeSeconds(nextCurrentTime);
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

const TelegramMessageAvatar = ({
  label,
  imageUrl,
}: {
  label: string;
  imageUrl?: string;
}) => {
  if (imageUrl) {
    return (
      <div className="telegram-avatar small">
        <img src={imageUrl} alt={`${label} avatar`} loading="lazy" />
      </div>
    );
  }

  return <div className="telegram-avatar small fallback">{label.slice(0, 2).toUpperCase()}</div>;
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
            await window.pelec.openConnectorDocument('telegram', activeChatId, message.id);
          }}
        >
          Open
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

const TelegramAnimation = ({
  message,
}: {
  message: ChatMessage;
}) => {
  if (!message.animationUrl) {
    return null;
  }

  if ((message.animationMimeType ?? '').startsWith('image/')) {
    return (
      <img
        className="telegram-message-animation"
        src={message.animationUrl}
        alt="Telegram animation"
        loading="lazy"
      />
    );
  }

  return (
    <video
      className="telegram-message-animation"
      src={message.animationUrl}
      autoPlay
      loop
      muted
      playsInline
      controls={false}
      preload="auto"
      aria-label="Telegram animation"
    />
  );
};

const isTelegramAnimatedStickerVideoUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('data:video/')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    const filePath = parsed.searchParams.get('path')?.trim()?.toLowerCase() ?? parsed.pathname.toLowerCase();
    return filePath.endsWith('.webm') || filePath.endsWith('.mp4');
  } catch {
    return trimmed.toLowerCase().endsWith('.webm') || trimmed.toLowerCase().endsWith('.mp4');
  }
};

const TelegramSticker = ({
  message,
}: {
  message: ChatMessage;
}) => {
  if (!message.stickerUrl) {
    return null;
  }

  const alt = message.stickerEmoji
    ? `Telegram sticker ${message.stickerEmoji}`
    : 'Telegram sticker';

  if (message.stickerIsAnimated && isTelegramAnimatedStickerVideoUrl(message.stickerUrl)) {
    return (
      <video
        className="telegram-message-sticker telegram-message-sticker-video"
        src={message.stickerUrl}
        autoPlay
        loop
        muted
        playsInline
        controls={false}
        preload="auto"
        aria-label={alt}
        title="Animated sticker"
      />
    );
  }

  return (
    <img
      className="telegram-message-sticker"
      src={message.stickerUrl}
      alt={alt}
      loading="lazy"
      title={message.stickerIsAnimated ? 'Animated sticker preview' : undefined}
    />
  );
};

const TelegramPollCard = ({
  activeChatId,
  message,
}: {
  activeChatId: string | null;
  message: ChatMessage;
}) => {
  const poll = message.poll;
  const chosenOptionIds = (poll?.options ?? []).reduce<number[]>((accumulator, option, index) => {
    if (option.chosen) {
      accumulator.push(index);
    }
    return accumulator;
  }, []);
  const [draftOptionIds, setDraftOptionIds] = useState<number[]>(chosenOptionIds);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraftOptionIds(chosenOptionIds);
    setSubmitting(false);
    setSubmitError(null);
  }, [
    message.id,
    poll?.question,
    poll?.totalVoterCount,
    poll?.isClosed,
    poll?.allowsMultipleAnswers,
    poll?.kind,
    poll?.options,
    chosenOptionIds.join(','),
  ]);

  if (!poll) {
    return null;
  }

  const badges = [
    poll.kind === 'quiz' ? 'Quiz' : 'Poll',
    poll.isClosed ? 'Closed' : null,
    poll.isAnonymous === false ? 'Public' : null,
    poll.allowsMultipleAnswers ? 'Multi-select' : null,
  ].filter((badge): badge is string => !!badge);

  const totalVoters = poll.totalVoterCount ?? poll.options.reduce((sum, option) => sum + option.voterCount, 0);
  const hasPerOptionResults = poll.options.some(
    (option) =>
      option.chosen === true ||
      option.voterCount > 0 ||
      (typeof option.votePercentage === 'number' && option.votePercentage > 0),
  );
  const shouldHideOptionResults =
    totalVoters > 0 && !poll.isClosed && !hasPerOptionResults;
  const footerParts =
    totalVoters > 0
      ? [`${formatTelegramPollCount(totalVoters)} vote${totalVoters === 1 ? '' : 's'}`]
      : ['No votes yet'];

  if (poll.isAnonymous !== undefined) {
    footerParts.push(poll.isAnonymous ? 'Anonymous' : 'Public votes');
  }

  if (poll.allowsMultipleAnswers) {
    footerParts.push('Multiple answers');
  }

  if (shouldHideOptionResults) {
    footerParts.push('Results hidden until you vote');
  }

  const canVote =
    !!activeChatId &&
    !poll.isClosed &&
    !(poll.kind === 'quiz' && chosenOptionIds.length > 0);
  const hasDraftChanges =
    draftOptionIds.length !== chosenOptionIds.length ||
    draftOptionIds.some((optionId, index) => optionId !== chosenOptionIds[index]);

  const submitVote = async (optionIds: number[]): Promise<void> => {
    if (!activeChatId || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    const normalizedOptionIds = [...new Set(optionIds)].sort((left, right) => left - right);
    const voted = await window.pelec.answerConnectorPoll('telegram', activeChatId, message.id, normalizedOptionIds);
    setSubmitting(false);
    if (!voted) {
      setSubmitError('Vote failed');
      return;
    }
    setDraftOptionIds(normalizedOptionIds);
  };

  return (
    <section className={`telegram-poll-card${poll.kind === 'quiz' ? ' is-quiz' : ''}${poll.isClosed ? ' is-closed' : ''}`}>
      <div className="telegram-poll-badges" aria-label="Telegram poll details">
        {badges.map((badge) => (
          <span key={badge} className="telegram-poll-badge">
            {badge}
          </span>
        ))}
      </div>
      <div className="telegram-poll-question">{poll.question}</div>
      <div className="telegram-poll-options">
        {poll.options.map((option, index) => {
          const votePercentage =
            option.votePercentage ??
            (totalVoters > 0 ? Math.round((option.voterCount / totalVoters) * 100) : 0);
          const isCorrect = poll.kind === 'quiz' && poll.correctOptionIndex === index;
          const showOptionResults = !shouldHideOptionResults;
          const selected = draftOptionIds.includes(index);

          return (
            <button
              key={`${message.id}:poll:${index}`}
              type="button"
              className={`telegram-poll-option${option.chosen ? ' is-chosen' : ''}${isCorrect ? ' is-correct' : ''}`}
              disabled={!canVote || submitting}
              aria-pressed={selected}
              onClick={(event) => {
                event.stopPropagation();
                if (!canVote || submitting) {
                  return;
                }
                if (!poll.allowsMultipleAnswers) {
                  void submitVote([index]);
                  return;
                }

                setDraftOptionIds((current) => {
                  const next = current.includes(index)
                    ? current.filter((optionId) => optionId !== index)
                    : [...current, index].sort((left, right) => left - right);
                  setSubmitError(null);
                  return next;
                });
              }}
              title={canVote ? `Vote for ${option.text}` : undefined}
            >
              <div
                className="telegram-poll-option-fill"
                style={{ width: `${showOptionResults ? Math.min(100, Math.max(0, votePercentage)) : 0}%` }}
              />
              <div className="telegram-poll-option-content">
                <span className="telegram-poll-option-label">{option.text}</span>
                <span className="telegram-poll-option-meta">
                  {showOptionResults
                    ? `${votePercentage}% · ${formatTelegramPollCount(option.voterCount)}`
                    : 'Results hidden'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {poll.allowsMultipleAnswers && canVote ? (
        <div className="telegram-poll-actions">
          <button
            type="button"
            className="telegram-poll-action"
            disabled={submitting || !hasDraftChanges}
            onClick={(event) => {
              event.stopPropagation();
              void submitVote(draftOptionIds);
            }}
          >
            {submitting ? 'Voting…' : 'Vote'}
          </button>
          <button
            type="button"
            className="telegram-poll-action secondary"
            disabled={submitting || draftOptionIds.length < 1}
            onClick={(event) => {
              event.stopPropagation();
              setDraftOptionIds([]);
              setSubmitError(null);
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
      {submitError ? <div className="telegram-poll-submit-error">{submitError}</div> : null}
      <div className="telegram-poll-footer">{footerParts.join(' · ')}</div>
    </section>
  );
};

function TelegramDeferredImage({
  activeChatId,
  legacyApi,
  message,
}: {
  activeChatId: string | null;
  legacyApi: LegacyAppBridgeApi | null;
  message: LegacyRenderableTelegramMessage;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (imageUrl) {
    return (
      <img
        className="telegram-message-image"
        src={imageUrl}
        alt="Telegram image"
        loading="lazy"
        onClick={(event) => {
          event.stopPropagation();
          legacyApi?.openTelegramImagePreview(imageUrl, {
            imageSizeBytes: message.imageSizeBytes,
            sender: message.sender,
            senderAvatarUrl: message.senderAvatarUrl,
            timestamp: message.timestamp,
          });
        }}
      />
    );
  }

  return (
    <div className="telegram-deferred-image">
      <strong>Large image</strong>
      <span>{formatFileSize(message.imageSizeBytes) || 'Over 10 MB'}</span>
      <button
        type="button"
        disabled={loading || !activeChatId}
        onClick={async (event) => {
          event.stopPropagation();
          if (!activeChatId || loading) {
            return;
          }
          setLoading(true);
          setError(null);
          try {
            const resolved = await window.pelec.resolveConnectorImageUrl(
              'telegram',
              activeChatId,
              message.id,
            );
            if (!resolved) {
              throw new Error('Telegram did not return the image.');
            }
            setImageUrl(resolved);
          } catch (resolveError) {
            setError(resolveError instanceof Error ? resolveError.message : 'Image download failed.');
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? 'Downloading…' : 'Download and view'}
      </button>
      {error ? <span className="telegram-deferred-image-error">{error}</span> : null}
    </div>
  );
}

const TelegramMessageRow = memo(
  ({
    activeChatId,
    bundle,
    isSelected,
    legacyApi,
    messageTextSelectable,
    playbackCoordinator,
    playbackRate,
    onPlaybackRateChange,
  }: {
    activeChatId: string | null;
    bundle: MessageBundle;
    isSelected: boolean;
    legacyApi: LegacyAppBridgeApi | null;
    messageTextSelectable: boolean;
    playbackCoordinator: TelegramVoicePlaybackCoordinator;
    playbackRate: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number];
    onPlaybackRateChange(value: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]): void;
  }) => {
    const { albumCaption, previousMessage, primaryMessage, renderMessages, shouldCollapseAlbum, showDayDivider } =
      bundle;
    const rawMessageTextValue = shouldCollapseAlbum ? albumCaption : safeText(primaryMessage.text);
    const limitedMessageText = limitTelegramRenderedText(rawMessageTextValue);
    const messageTextValue = limitedMessageText.text;
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
    const suppressPollFallbackText = !!primaryMessage.poll;
    const shouldRenderText =
      !!messageTextTrimmed &&
      !primaryMessage.call &&
      !suppressImageFallbackText &&
      !suppressVideoFallbackText &&
      !suppressPollFallbackText &&
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
      !(primaryMessage.audioUrl || primaryMessage.hasAudio) &&
      !primaryMessage.poll;
    const isPollOnlyMessage =
      !!primaryMessage.poll &&
      !shouldRenderText &&
      !primaryMessage.call &&
      !primaryMessage.imageUrl &&
      !primaryMessage.videoUrl &&
      !primaryMessage.hasVideo &&
      !primaryMessage.animationUrl &&
      !primaryMessage.stickerUrl &&
      !(primaryMessage.audioUrl || primaryMessage.hasAudio) &&
      !primaryMessage.document;

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
          }${isPollOnlyMessage ? ' poll-only' : ''}${
            primaryMessage.poll ? ' has-poll' : ''
          }${
            messageTextSelectable ? ' selectable-text' : ''
          }`}
          data-message-id={primaryMessage.id}
          onClick={(event) => {
            if (hasSelectionInsideElement(event.currentTarget)) {
              return;
            }
            legacyApi?.selectTelegramMessage(primaryMessage.id);
          }}
          onContextMenu={(event) => {
            if (hasSelectionInsideElement(event.currentTarget)) {
              return;
            }
            event.preventDefault();
            legacyApi?.openTelegramContextMenu(primaryMessage.id, event.clientX, event.clientY);
          }}
        >
          {!isContinuation ? (
            <div className="telegram-message-header">
              {primaryMessage.outgoing ? null : (
                <TelegramMessageAvatar label={senderLabel} imageUrl={primaryMessage.senderAvatarUrl} />
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
                    <TelegramResolvedVideo activeChatId={activeChatId} message={albumMessage} variant="album" />
                  </div>
                ) : (
                  <button
                    key={albumMessage.id}
                    type="button"
                    className="telegram-message-album-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (albumMessage.imageUrl) {
                        legacyApi?.openTelegramImagePreview(albumMessage.imageUrl, {
                          imageSizeBytes: albumMessage.imageSizeBytes,
                          sender: albumMessage.sender,
                          senderAvatarUrl: albumMessage.senderAvatarUrl,
                          timestamp: albumMessage.timestamp,
                        });
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
          ) : primaryMessage.imageDeferred ? (
            <TelegramDeferredImage
              activeChatId={activeChatId}
              legacyApi={legacyApi}
              message={primaryMessage}
            />
          ) : primaryMessage.imageUrl ? (
            <img
              className="telegram-message-image"
              src={primaryMessage.imageUrl}
              alt="Telegram image"
              loading="lazy"
              onClick={(event) => {
                event.stopPropagation();
                legacyApi?.openTelegramImagePreview(primaryMessage.imageUrl as string, {
                  imageSizeBytes: primaryMessage.imageSizeBytes,
                  sender: primaryMessage.sender,
                  senderAvatarUrl: primaryMessage.senderAvatarUrl,
                  timestamp: primaryMessage.timestamp,
                });
              }}
            />
          ) : null}
          {!shouldCollapseAlbum && (primaryMessage.videoUrl || primaryMessage.hasVideo) ? (
            <TelegramResolvedVideo activeChatId={activeChatId} message={primaryMessage} />
          ) : null}
          {!shouldCollapseAlbum && primaryMessage.animationUrl ? (
            <TelegramAnimation message={primaryMessage} />
          ) : null}
          {!shouldCollapseAlbum && (primaryMessage.audioUrl || primaryMessage.hasAudio) ? (
            <TelegramResolvedAudio
              activeChatId={activeChatId}
              message={primaryMessage}
              playbackCoordinator={playbackCoordinator}
              playbackRate={playbackRate}
              onPlaybackRateChange={onPlaybackRateChange}
            />
          ) : null}
          <TelegramSticker message={primaryMessage} />
          <TelegramPollCard activeChatId={activeChatId} message={primaryMessage} />
          <TelegramDocumentCard activeChatId={activeChatId} message={primaryMessage} />
          {shouldRenderText ? (
            <div className="telegram-message-text">
              {renderTelegramRichText(
                messageTextTrimmed,
                !limitedMessageText.truncated &&
                  !shouldCollapseAlbum &&
                  messageTextTrimmed === safeText(primaryMessage.text).trim()
                  ? primaryMessage.textEntities
                  : undefined,
              )}
              {limitedMessageText.truncated ? (
                <div className="telegram-message-truncated" role="note">
                  Oversized message {primaryMessage.id}: showing{' '}
                  {TELEGRAM_MAX_RENDERED_TEXT_LENGTH.toLocaleString()} of{' '}
                  {limitedMessageText.originalLength.toLocaleString()} characters.
                </div>
              ) : null}
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
                ) : primaryMessage.readByPeer ? (
                  <span className="telegram-message-tick double" aria-label="Read">
                    ✓✓
                  </span>
                ) : (
                  <span className="telegram-message-tick" aria-label="Sent">
                    ✓
                  </span>
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
    previous.legacyApi === next.legacyApi &&
    previous.messageTextSelectable === next.messageTextSelectable &&
    previous.playbackCoordinator === next.playbackCoordinator &&
    previous.playbackRate === next.playbackRate &&
    previous.onPlaybackRateChange === next.onPlaybackRateChange,
);

export const TelegramMessageList = ({
  activeChatId,
  activeChatTitle,
  canDropFiles = false,
  hasOlderMessages = false,
  legacyApi,
  loadError,
  loadingOlderMessages = false,
  messages,
  messagesLoading,
  messageTextSelectable = false,
  onBackToChats,
  selectedMessageId,
  target,
}: TelegramMessageListProps) => {
  const [dragDepth, setDragDepth] = useState(0);
  const bundles = useStableMessageBundles(messages);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [jumpToLatestStyle, setJumpToLatestStyle] = useState<CSSProperties | null>(null);
  const [voicePlaybackRate, setVoicePlaybackRate] =
    useState<(typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]>(1);
  const pendingAutoScrollRef = useRef<string | null>(null);
  const pendingOlderHistoryAnchorRef = useRef<{ firstMessageId: string; scrollHeight: number } | null>(null);
  const latestScrollFollowupTimerRef = useRef<number | null>(null);
  const previousLoadingOlderMessagesRef = useRef(loadingOlderMessages);
  const previousMessagesLoadingRef = useRef(messagesLoading);
  const previousActiveChatIdRef = useRef(activeChatId);
  const autoScrollGraceRef = useRef<{ chatId: string | null; expiresAt: number }>({
    chatId: null,
    expiresAt: 0,
  });
  const programmaticScrollRef = useRef(false);
  const playbackCoordinator = useMemo<TelegramVoicePlaybackCoordinator>(() => {
    const activeAudioRef: { current: HTMLAudioElement | null } = { current: null };
    let latestRequestId = 0;

    return {
      activate(audio) {
        if (activeAudioRef.current && activeAudioRef.current !== audio) {
          activeAudioRef.current.pause();
        }
        activeAudioRef.current = audio;
      },
      beginRequest() {
        latestRequestId += 1;
        return latestRequestId;
      },
      isCurrentRequest(requestId) {
        return latestRequestId === requestId;
      },
      release(audio) {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
      },
      stopActive() {
        latestRequestId += 1;
        if (activeAudioRef.current) {
          activeAudioRef.current.pause();
          activeAudioRef.current = null;
        }
      },
    };
  }, []);

  useEffect(() => {
    if (!loadError) {
      return;
    }
    console.error('[telegram][conversation-load] Failed to load conversation messages', {
      activeChatId,
      activeChatTitle,
      error: loadError,
      messageCount: messages.length,
      timestamp: new Date().toISOString(),
    });
  }, [activeChatId, activeChatTitle, loadError, messages.length]);

  useEffect(() => {
    return () => {
      if (latestScrollFollowupTimerRef.current !== null) {
        window.clearTimeout(latestScrollFollowupTimerRef.current);
      }
      playbackCoordinator.stopActive();
    };
  }, [playbackCoordinator]);

  useEffect(() => {
    playbackCoordinator.stopActive();
  }, [activeChatId, playbackCoordinator]);

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
    pendingOlderHistoryAnchorRef.current = null;
  }, [activeChatId]);

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
      setJumpToLatestStyle(null);
      return;
    }

    const updateJumpState = () => {
      const distanceFromBottom = getTelegramMessageDistanceFromBottom(scrollContainer);
      if (distanceFromBottom > TELEGRAM_LATEST_PROXIMITY_PX && !programmaticScrollRef.current) {
        autoScrollGraceRef.current = {
          chatId: null,
          expiresAt: 0,
        };
      }
      setShowJumpToLatest(distanceFromBottom > TELEGRAM_LATEST_PROXIMITY_PX);
    };

    updateJumpState();
    scrollContainer.addEventListener('scroll', updateJumpState, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', updateJumpState);
    };
  }, [target, activeChatId, bundles.length, messagesLoading]);

  useEffect(() => {
    if (!showJumpToLatest) {
      setJumpToLatestStyle(null);
      return;
    }

    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer) {
      setJumpToLatestStyle(null);
      return;
    }

    const updateJumpPosition = () => {
      const rect = scrollContainer.getBoundingClientRect();
      setJumpToLatestStyle({
        bottom: Math.max(
          TELEGRAM_JUMP_LATEST_OFFSET_PX,
          window.innerHeight - rect.bottom + TELEGRAM_JUMP_LATEST_OFFSET_PX,
        ),
        right: Math.max(
          TELEGRAM_JUMP_LATEST_OFFSET_PX,
          window.innerWidth - rect.right + TELEGRAM_JUMP_LATEST_OFFSET_PX,
        ),
      });
    };

    updateJumpPosition();
    window.addEventListener('resize', updateJumpPosition);
    window.addEventListener('scroll', updateJumpPosition, true);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateJumpPosition);
    resizeObserver?.observe(scrollContainer);

    return () => {
      window.removeEventListener('resize', updateJumpPosition);
      window.removeEventListener('scroll', updateJumpPosition, true);
      resizeObserver?.disconnect();
    };
  }, [showJumpToLatest, target]);

  useEffect(() => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer || !legacyApi || !activeChatId) {
      pendingOlderHistoryAnchorRef.current = null;
      return;
    }

    const maybeLoadOlderMessages = () => {
      if (
        scrollContainer.scrollTop > 32 ||
        loadingOlderMessages ||
        messagesLoading ||
        !hasOlderMessages ||
        messages.length < 1 ||
        pendingOlderHistoryAnchorRef.current
      ) {
        return;
      }

      const firstMessageId = messages[0]?.id;
      if (!firstMessageId) {
        return;
      }

      pendingOlderHistoryAnchorRef.current = {
        firstMessageId,
        scrollHeight: scrollContainer.scrollHeight,
      };
      void legacyApi.loadOlderTelegramMessages();
    };

    scrollContainer.addEventListener('scroll', maybeLoadOlderMessages, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', maybeLoadOlderMessages);
    };
  }, [
    activeChatId,
    hasOlderMessages,
    legacyApi,
    loadingOlderMessages,
    messages,
    messagesLoading,
    target,
  ]);

  useEffect(() => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    const wasLoadingOlderMessages = previousLoadingOlderMessagesRef.current;
    previousLoadingOlderMessagesRef.current = loadingOlderMessages;
    if (!scrollContainer || loadingOlderMessages || !wasLoadingOlderMessages) {
      return;
    }

    const pendingAnchor = pendingOlderHistoryAnchorRef.current;
    pendingOlderHistoryAnchorRef.current = null;
    if (!pendingAnchor) {
      return;
    }

    if (messages[0]?.id === pendingAnchor.firstMessageId) {
      return;
    }

    runAfterPaint(() => {
      scrollContainer.scrollTop += scrollContainer.scrollHeight - pendingAnchor.scrollHeight;
    });
  }, [loadingOlderMessages, messages, target]);

  useEffect(() => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer || !activeChatId || messagesLoading) {
      return;
    }
    const hasPendingAutoScroll = pendingAutoScrollRef.current === activeChatId;
    const shouldContinueAutoScroll =
      !hasPendingAutoScroll &&
      shouldKeepAutoScrolling(activeChatId) &&
      getTelegramMessageDistanceFromBottom(scrollContainer) <= TELEGRAM_LATEST_PROXIMITY_PX;

    if (!hasPendingAutoScroll && !shouldContinueAutoScroll) {
      return;
    }

    pendingAutoScrollRef.current = null;
    runAfterPaint(() => {
      if (
        !hasPendingAutoScroll &&
        getTelegramMessageDistanceFromBottom(scrollContainer) > TELEGRAM_LATEST_PROXIMITY_PX
      ) {
        return;
      }
      scrollToLatestMessage('auto');
      setShowJumpToLatest(false);
    });
  }, [activeChatId, messagesLoading, bundles.length, target]);

  useEffect(() => {
    if (!target || !legacyApi) {
      return;
    }

    const scrollContainer = getTelegramMessageScrollContainer(target);
    const activateMessagesPane = (event: Event) => {
      if (
        isSelectableMessageTextTarget(event.target) ||
        isTelegramMessageInteractiveTarget(event.target)
      ) {
        return;
      }
      if (scrollContainer && scrollContainer.tabIndex < 0) {
        scrollContainer.focus({ preventScroll: true });
      }
      legacyApi.activateTelegramMessagesPane();
    };

    target.addEventListener('mousedown', activateMessagesPane);
    target.addEventListener('focusin', activateMessagesPane);
    if (scrollContainer && scrollContainer !== target) {
      scrollContainer.addEventListener('mousedown', activateMessagesPane);
      scrollContainer.addEventListener('focusin', activateMessagesPane);
    }
    return () => {
      target.removeEventListener('mousedown', activateMessagesPane);
      target.removeEventListener('focusin', activateMessagesPane);
      if (scrollContainer && scrollContainer !== target) {
        scrollContainer.removeEventListener('mousedown', activateMessagesPane);
        scrollContainer.removeEventListener('focusin', activateMessagesPane);
      }
    };
  }, [legacyApi, target]);

  useEffect(() => {
    if (!target || !messageTextSelectable) {
      return;
    }

    const handleCopy = (event: ClipboardEvent) => {
      const selectedText = getSelectedTextInsideElement(target).trim();
      if (!selectedText) {
        return;
      }

      event.clipboardData?.setData('text/plain', selectedText);
      event.preventDefault();
    };

    target.addEventListener('copy', handleCopy);
    return () => {
      target.removeEventListener('copy', handleCopy);
    };
  }, [messageTextSelectable, target]);

  useEffect(() => {
    if (!target || !messageTextSelectable) {
      return;
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (!isSelectableMessageTextTarget(event.target)) {
        return;
      }

      void copySelectedTextInsideElement(target);
    };

    target.addEventListener('mouseup', handleMouseUp);
    return () => {
      target.removeEventListener('mouseup', handleMouseUp);
    };
  }, [messageTextSelectable, target]);

  useEffect(() => {
    const scrollContainer = getTelegramMessageScrollContainer(target);
    if (!scrollContainer || !legacyApi || !canDropFiles) {
      setDragDepth(0);
      return;
    }

    const hasDraggedFiles = (dataTransfer: DataTransfer | null): boolean => {
      if (!dataTransfer) {
        return false;
      }

      if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')) {
        return true;
      }

      return Array.from(dataTransfer.files ?? []).length > 0;
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      setDragDepth((depth) => depth + 1);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      setDragDepth((depth) => Math.max(0, depth - 1));
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      setDragDepth(0);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        legacyApi.appendTelegramFiles(files);
      }
    };

    scrollContainer.addEventListener('dragenter', handleDragEnter);
    scrollContainer.addEventListener('dragover', handleDragOver);
    scrollContainer.addEventListener('dragleave', handleDragLeave);
    scrollContainer.addEventListener('drop', handleDrop);

    return () => {
      scrollContainer.removeEventListener('dragenter', handleDragEnter);
      scrollContainer.removeEventListener('dragover', handleDragOver);
      scrollContainer.removeEventListener('dragleave', handleDragLeave);
      scrollContainer.removeEventListener('drop', handleDrop);
    };
  }, [canDropFiles, legacyApi, target]);

  if (!target) {
    return null;
  }

  const scrollContainer = getTelegramMessageScrollContainer(target);
  const dragActive = dragDepth > 0 && canDropFiles;

  return (
    <>
      {createPortal(
        <>
          {onBackToChats ? (
            <div className="telegram-message-nav">
              <button
                type="button"
                className="telegram-message-back-button"
                onClick={onBackToChats}
              >
                Back to chats
              </button>
            </div>
          ) : null}
          {messagesLoading ? <div className="telegram-empty">Loading messages...</div> : null}
          {!messagesLoading && loadError ? (
            <div className="telegram-empty telegram-load-error" role="alert">
              <strong>Messages could not be loaded.</strong>
              <span>{loadError}</span>
              <small>
                Chat: {activeChatTitle || 'Telegram chat'} ({activeChatId || 'unknown ID'})
              </small>
            </div>
          ) : null}
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
                  messageTextSelectable={messageTextSelectable}
                  playbackCoordinator={playbackCoordinator}
                  playbackRate={voicePlaybackRate}
                  onPlaybackRateChange={setVoicePlaybackRate}
                />
              ))
            : null}
        </>,
        target,
      )}
      {showJumpToLatest && jumpToLatestStyle
        ? createPortal(
            <button
              type="button"
              className="telegram-jump-latest-button"
              style={jumpToLatestStyle}
              onClick={() => {
                scrollToLatestMessage('smooth');
                setShowJumpToLatest(false);
              }}
            >
              Jump to latest
            </button>,
            document.body,
          )
        : null}
      {scrollContainer && dragActive
        ? createPortal(
            <div className="telegram-message-drop-target">Drop files to attach</div>,
            scrollContainer,
          )
        : null}
    </>
  );
};
