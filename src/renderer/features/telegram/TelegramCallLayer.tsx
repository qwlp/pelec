import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Users,
  Video,
  X,
} from 'lucide-react';
import type {
  TelegramCallCapabilities,
  TelegramCallDevice,
  TelegramCallState,
  TelegramCallUpdate,
} from '../../../shared/connectors';
import { formatDuration } from '../../lib/format';
import { renderI420Frame } from './i420Renderer';

const EMPTY_CALL_STATE: TelegramCallState = {
  session: null,
  participants: [],
  devices: [],
  metrics: {},
};

interface TelegramCallLayerProps {
  activeChatId: string | null;
  capabilities?: TelegramCallCapabilities;
  headerTarget: HTMLElement | null;
}

const applyUpdate = (state: TelegramCallState, update: TelegramCallUpdate): TelegramCallState => {
  if (update.kind === 'session') return { ...state, session: update.session };
  if (update.kind === 'participants') return { ...state, participants: update.participants };
  if (update.kind === 'devices') return { ...state, devices: update.devices };
  if (update.kind === 'metrics') return { ...state, metrics: update.metrics };
  return state;
};

const DeviceSelect = ({
  devices,
  kind,
  label,
  onChange,
}: {
  devices: TelegramCallDevice[];
  kind: TelegramCallDevice['kind'];
  label: string;
  onChange(kind: TelegramCallDevice['kind'], id: string): void;
}) => {
  const matches = devices.filter((device) => device.kind === kind);
  if (matches.length < 1) return null;
  return (
    <label className="telegram-call-device">
      <span>{label}</span>
      <select
        value={matches.find((device) => device.selected)?.id ?? matches[0].id}
        onChange={(event) => onChange(kind, event.currentTarget.value)}
      >
        {matches.map((device) => (
          <option key={device.id} value={device.id}>
            {device.label}
          </option>
        ))}
      </select>
    </label>
  );
};

export const TelegramCallLayer = ({
  activeChatId,
  capabilities,
  headerTarget,
}: TelegramCallLayerProps) => {
  const [callState, setCallState] = useState<TelegramCallState>(EMPTY_CALL_STATE);
  const [error, setError] = useState<string | null>(null);
  const session = callState.session;

  useEffect(() => {
    let cancelled = false;
    void window.pelec.getTelegramCallState().then((state) => {
      if (!cancelled && state) setCallState(state);
    });
    const unsubscribe = window.pelec.onTelegramCallUpdate((update) => {
      setCallState((state) => applyUpdate(state, update));
      if (update.kind === 'terminal' && update.error) setError(update.error);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(
    () =>
      window.pelec.onTelegramCallVideoFrame((frame) => {
        const canvas = [...document.querySelectorAll<HTMLCanvasElement>('[data-call-video]')].find(
          (candidate) => candidate.dataset.callVideo === frame.endpointId,
        );
        if (canvas) {
          renderI420Frame(canvas, frame);
        }
      }),
    [],
  );

  const run = async (action: () => Promise<TelegramCallState>) => {
    setError(null);
    try {
      setCallState(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const headerActions = headerTarget
    ? createPortal(
        <div className="telegram-call-header-actions">
          {capabilities?.activeGroupCallId && activeChatId ? (
            <button
              type="button"
              title="Join video chat"
              aria-label="Join Telegram video chat"
              disabled={Boolean(session)}
              onClick={() => void run(() => window.pelec.joinTelegramGroupCall(activeChatId, false))}
            >
              <Users size={17} />
            </button>
          ) : null}
          {capabilities?.callable && activeChatId ? (
            <button
              type="button"
              title="Voice call"
              aria-label="Start Telegram voice call"
              disabled={Boolean(session)}
              onClick={() => void run(() => window.pelec.startTelegramCall(activeChatId, false))}
            >
              <Phone size={17} />
            </button>
          ) : null}
          {capabilities?.callable && capabilities.supportsVideo && activeChatId ? (
            <button
              type="button"
              title="Video call"
              aria-label="Start Telegram video call"
              disabled={Boolean(session)}
              onClick={() => void run(() => window.pelec.startTelegramCall(activeChatId, true))}
            >
              <Video size={18} />
            </button>
          ) : null}
        </div>,
        headerTarget,
      )
    : null;

  const participantEndpoints = useMemo(
    () =>
      callState.participants
        .map((participant) => participant.videoEndpointId)
        .filter((endpoint): endpoint is string => Boolean(endpoint)),
    [callState.participants],
  );

  useEffect(() => {
    if (session?.kind !== 'group') return;
    void window.pelec.setTelegramVisibleVideoEndpoints(participantEndpoints);
  }, [participantEndpoints, session?.kind]);

  if (!session) {
    return (
      <>
        {headerActions}
        {error ? (
          <div className="telegram-call-error" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Dismiss call error" onClick={() => setError(null)}>
              <X size={15} />
            </button>
          </div>
        ) : null}
      </>
    );
  }

  const incoming = session.direction === 'incoming' && session.phase === 'ringing';
  const videoSurface = session.isVideo || session.kind === 'group';

  return (
    <>
      {headerActions}
      {incoming ? (
        <div className="telegram-call-backdrop">
          <section className="telegram-incoming-call" role="dialog" aria-modal="true">
            <div className="telegram-call-kicker">
              Incoming {session.isVideo ? 'video' : 'voice'} call
            </div>
            <h2>{session.peerLabel}</h2>
            <div className="telegram-incoming-call-actions">
              <button
                type="button"
                className="is-decline"
                aria-label="Decline call"
                onClick={() => void run(() => window.pelec.declineTelegramCall())}
              >
                <PhoneOff size={21} />
              </button>
              <button
                type="button"
                className="is-answer"
                aria-label="Answer voice call"
                onClick={() => void run(() => window.pelec.answerTelegramCall(false))}
              >
                <Phone size={21} />
              </button>
              {session.isVideo ? (
                <button
                  type="button"
                  className="is-answer"
                  aria-label="Answer video call"
                  onClick={() => void run(() => window.pelec.answerTelegramCall(true))}
                >
                  <Video size={22} />
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : videoSurface ? (
        <section className="telegram-video-call-surface" aria-label="Telegram call">
          <header>
            <div>
              <strong>{session.peerLabel}</strong>
              <span>
                {session.phase} · {formatDuration(session.durationSeconds)}
              </span>
            </div>
            <div className="telegram-call-security">{session.encryptionEmojis.join(' ')}</div>
          </header>
          <div className="telegram-call-video-grid">
            {session.kind === 'private' ? (
              <div className="telegram-call-video-tile is-remote">
                <canvas data-call-video="remote" />
                <span>{session.peerLabel}</span>
              </div>
            ) : (
              callState.participants.map((participant) => (
                <div
                  key={participant.id}
                  className={`telegram-call-video-tile${participant.speaking ? ' is-speaking' : ''}`}
                >
                  <canvas data-call-video={participant.videoEndpointId ?? participant.id} />
                  <span>
                    {participant.displayName}
                    {participant.muted ? ' · muted' : ''}
                  </span>
                </div>
              ))
            )}
            {session.cameraEnabled ? (
              <div className="telegram-call-video-tile is-local">
                <canvas data-call-video="local" />
                <span>You</span>
              </div>
            ) : null}
          </div>
          <CallControls callState={callState} run={run} />
        </section>
      ) : (
        <section className="telegram-voice-call-bar" aria-label="Telegram voice call">
          <div>
            <strong>{session.peerLabel}</strong>
            <span>
              {session.phase} · {formatDuration(session.durationSeconds)}
            </span>
          </div>
          <CallControls callState={callState} run={run} compact />
        </section>
      )}
      {error ? <div className="telegram-call-inline-error">{error}</div> : null}
    </>
  );
};

const CallControls = ({
  callState,
  run,
  compact = false,
}: {
  callState: TelegramCallState;
  run(action: () => Promise<TelegramCallState>): Promise<void>;
  compact?: boolean;
}) => {
  const session = callState.session;
  if (!session) return null;
  return (
    <div className={`telegram-call-controls${compact ? ' is-compact' : ''}`}>
      <button
        type="button"
        title={session.microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-label={session.microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}
        onClick={() =>
          void run(() => window.pelec.setTelegramCallMuted(!session.microphoneMuted))
        }
      >
        {session.microphoneMuted ? <MicOff size={19} /> : <Mic size={19} />}
      </button>
      {session.isVideo || session.kind === 'group' ? (
        <button
          type="button"
          title={session.cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          aria-label={session.cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          onClick={() =>
            void run(() => window.pelec.setTelegramCallVideoEnabled(!session.cameraEnabled))
          }
        >
          {session.cameraEnabled ? <Camera size={19} /> : <CameraOff size={19} />}
        </button>
      ) : null}
      {!compact ? (
        <div className="telegram-call-devices">
          <DeviceSelect
            devices={callState.devices}
            kind="audio-input"
            label="Microphone"
            onChange={(kind, id) => void run(() => window.pelec.setTelegramCallDevice(kind, id))}
          />
          <DeviceSelect
            devices={callState.devices}
            kind="audio-output"
            label="Speaker"
            onChange={(kind, id) => void run(() => window.pelec.setTelegramCallDevice(kind, id))}
          />
          <DeviceSelect
            devices={callState.devices}
            kind="camera"
            label="Camera"
            onChange={(kind, id) => void run(() => window.pelec.setTelegramCallDevice(kind, id))}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="is-hangup"
        title="End call"
        aria-label="End Telegram call"
        onClick={() => void run(() => window.pelec.hangUpTelegramCall())}
      >
        <PhoneOff size={19} />
      </button>
    </div>
  );
};
