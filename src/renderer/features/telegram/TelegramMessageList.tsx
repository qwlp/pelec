import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
  legacyApi: LegacyAppBridgeApi | null;
  loadError: string | null;
  messages: LegacyRenderableTelegramMessage[];
  messagesLoading: boolean;
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

const formatTelegramVoicePlaybackRate = (rate: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]): string =>
  `${Number.isInteger(rate) ? rate.toFixed(0) : rate}x`;

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
    <div className={`${shellClassName}${shellStateClassName}`}>
      <button
        type="button"
        className="telegram-message-video-trigger"
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
    playbackCoordinator,
    playbackRate,
    onPlaybackRateChange,
  }: {
    activeChatId: string | null;
    bundle: MessageBundle;
    isSelected: boolean;
    legacyApi: LegacyAppBridgeApi | null;
    playbackCoordinator: TelegramVoicePlaybackCoordinator;
    playbackRate: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number];
    onPlaybackRateChange(value: (typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]): void;
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
            <TelegramResolvedAudio
              activeChatId={activeChatId}
              message={primaryMessage}
              playbackCoordinator={playbackCoordinator}
              playbackRate={playbackRate}
              onPlaybackRateChange={onPlaybackRateChange}
            />
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
    previous.legacyApi === next.legacyApi &&
    previous.playbackCoordinator === next.playbackCoordinator &&
    previous.playbackRate === next.playbackRate &&
    previous.onPlaybackRateChange === next.onPlaybackRateChange,
);

export const TelegramMessageList = ({
  activeChatId,
  activeChatTitle,
  canDropFiles = false,
  legacyApi,
  loadError,
  messages,
  messagesLoading,
  onBackToChats,
  selectedMessageId,
  target,
}: TelegramMessageListProps) => {
  const [dragDepth, setDragDepth] = useState(0);
  const bundles = useStableMessageBundles(messages);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [voicePlaybackRate, setVoicePlaybackRate] =
    useState<(typeof TELEGRAM_VOICE_PLAYBACK_RATES)[number]>(1);
  const pendingAutoScrollRef = useRef<string | null>(null);
  const latestScrollFollowupTimerRef = useRef<number | null>(null);
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

    const scrollContainer = getTelegramMessageScrollContainer(target);
    const activateMessagesPane = () => {
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
                  playbackCoordinator={playbackCoordinator}
                  playbackRate={voicePlaybackRate}
                  onPlaybackRateChange={setVoicePlaybackRate}
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
      {scrollContainer && dragActive
        ? createPortal(
            <div className="telegram-message-drop-target">Drop files to attach</div>,
            scrollContainer,
          )
        : null}
    </>
  );
};
