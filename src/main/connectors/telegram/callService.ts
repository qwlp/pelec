import { randomUUID } from 'node:crypto';
import type {
  TelegramCallDevice,
  TelegramCallParticipant,
  TelegramCallSession,
  TelegramCallState,
  TelegramCallUpdate,
  TelegramCallVideoFrame,
} from '../../../shared/connectors';
import type { TelegramUserConfig } from '../../../shared/types';
import type {
  TdCall,
  TdCallState,
  TdChat,
  TdClient,
  TdGroupCall,
  TdGroupCallParticipant,
} from './types';
import {
  TelegramCallEngineClient,
  type TelegramCallEngine,
  type TelegramCallEngineEvent,
  type TelegramCallEngineInfo,
} from './callEngine';

const EMPTY_STATE: TelegramCallState = {
  session: null,
  participants: [],
  devices: [],
  metrics: {},
};

type Invoke = <T>(request: Record<string, unknown>, label: string) => Promise<T>;

type TelegramCallServiceOptions = {
  config: TelegramUserConfig['calls'];
  getClient(): TdClient | null;
  invoke: Invoke;
  resolveUserLabel(userId: number): Promise<string>;
  engine?: TelegramCallEngine;
};

const cloneState = (state: TelegramCallState): TelegramCallState => ({
  session: state.session ? { ...state.session, encryptionEmojis: [...state.session.encryptionEmojis] } : null,
  participants: state.participants.map((participant) => ({ ...participant })),
  devices: state.devices.map((device) => ({ ...device })),
  metrics: { ...state.metrics },
});

const terminalReason = (
  reason: string | undefined,
): Extract<TelegramCallUpdate, { kind: 'terminal' }>['reason'] => {
  if (reason?.includes('Declined')) return 'declined';
  if (reason?.includes('Missed')) return 'missed';
  if (reason?.includes('Disconnected')) return 'disconnected';
  if (reason?.includes('Busy')) return 'busy';
  return 'hung-up';
};

export class TelegramCallService {
  private state: TelegramCallState = cloneState(EMPTY_STATE);
  private readonly listeners = new Set<(update: TelegramCallUpdate) => void>();
  private readonly videoFrameListeners = new Set<
    (frame: TelegramCallVideoFrame) => void
  >();
  private readonly engine: TelegramCallEngine;
  private engineInfo: TelegramCallEngineInfo | null = null;
  private tdCallId: number | null = null;
  private establishedAt: number | null = null;
  private durationTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: TelegramCallServiceOptions) {
    this.engine = options.engine ?? new TelegramCallEngineClient();
    this.engine.onEvent((event) => {
      void this.handleEngineEvent(event);
    });
  }

  onUpdate(handler: (update: TelegramCallUpdate) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onVideoFrame(handler: (frame: TelegramCallVideoFrame) => void): () => void {
    this.videoFrameListeners.add(handler);
    return () => this.videoFrameListeners.delete(handler);
  }

  getState(): TelegramCallState {
    return cloneState(this.state);
  }

  async shutdown(): Promise<void> {
    this.clearDurationTimer();
    await this.engine.stop();
    this.resetState();
    this.emitSession();
  }

  async startPrivateCall(chatId: string, isVideo: boolean): Promise<TelegramCallState> {
    this.assertIdle();
    this.assertPrivateFeature(isVideo);
    const chat = await this.options.invoke<TdChat>(
      { _: 'getChat', chat_id: Number(chatId) },
      'getChat for call',
    );
    if (chat.type?._ !== 'chatTypePrivate' || !chat.type.user_id) {
      throw new Error('Telegram private calls can only be started from a private user chat.');
    }
    const fullInfo = await this.options.invoke<{
      can_be_called?: boolean;
      supports_video_calls?: boolean;
      has_private_calls?: boolean;
    }>({ _: 'getUserFullInfo', user_id: chat.type.user_id }, 'getUserFullInfo for call');
    if (!fullInfo.can_be_called || fullInfo.has_private_calls) {
      throw new Error('This Telegram user cannot be called because of availability or privacy settings.');
    }
    if (isVideo && !fullInfo.supports_video_calls) {
      throw new Error('This Telegram user does not support video calls.');
    }

    const protocol = await this.getTdProtocol();
    const result = await this.options.invoke<{ id?: number }>(
      {
        _: 'createCall',
        user_id: chat.type.user_id,
        protocol,
        is_video: isVideo,
      },
      'createCall',
    );
    this.tdCallId = result.id ?? null;
    this.setSession({
      sessionId: randomUUID(),
      kind: 'private',
      chatId,
      userId: chat.type.user_id,
      peerLabel: chat.title ?? (await this.options.resolveUserLabel(chat.type.user_id)),
      direction: 'outgoing',
      isVideo,
      phase: 'ringing',
      durationSeconds: 0,
      microphoneMuted: false,
      cameraEnabled: isVideo,
      encryptionEmojis: [],
    });
    return this.getState();
  }

  async answerPrivateCall(isVideo: boolean): Promise<TelegramCallState> {
    const session = this.requirePrivateSession();
    if (session.direction !== 'incoming' || session.phase !== 'ringing' || !this.tdCallId) {
      throw new Error('There is no incoming Telegram call to answer.');
    }
    if (isVideo && !this.options.config.privateVideo) {
      throw new Error('Telegram private video calls are disabled.');
    }
    session.isVideo = session.isVideo && isVideo;
    session.cameraEnabled = session.isVideo;
    session.phase = 'connecting';
    this.emitSession();
    await this.options.invoke(
      { _: 'acceptCall', call_id: this.tdCallId, protocol: await this.getTdProtocol() },
      'acceptCall',
    );
    return this.getState();
  }

  async decline(): Promise<TelegramCallState> {
    return this.endPrivateCall(false);
  }

  async hangUp(): Promise<TelegramCallState> {
    if (this.state.session?.kind === 'group') {
      return this.leaveGroupCall();
    }
    return this.endPrivateCall(false);
  }

  async joinGroupCall(chatId: string, isVideo: boolean): Promise<TelegramCallState> {
    this.assertIdle();
    if (!this.options.config.group) {
      throw new Error('Telegram group calls are disabled.');
    }
    const chat = await this.options.invoke<TdChat>(
      { _: 'getChat', chat_id: Number(chatId) },
      'getChat for group call',
    );
    const groupCallId = chat.video_chat?.group_call_id ?? 0;
    if (!groupCallId) {
      throw new Error('This chat has no active Telegram video chat.');
    }
    const group = await this.options.invoke<TdGroupCall>(
      { _: 'getGroupCall', group_call_id: groupCallId },
      'getGroupCall',
    );
    if (!group.is_active) {
      throw new Error('The Telegram video chat is not active.');
    }

    const join = await this.engine.request<{ audioSourceId: number; payload: string }>(
      'createGroupSession',
      { groupCallId, isVideo },
    );
    const info = await this.options.invoke<{ group_call_id?: number; join_payload?: string }>(
      {
        _: 'joinVideoChat',
        group_call_id: groupCallId,
        participant_id: null,
        join_parameters: {
          _: 'groupCallJoinParameters',
          audio_source_id: join.audioSourceId,
          payload: join.payload,
          is_muted: false,
          is_my_video_enabled: isVideo,
        },
        invite_hash: '',
      },
      'joinVideoChat',
    );
    await this.engine.request('setGroupJoinResponse', {
      payload: info.join_payload ?? '',
    });
    this.setSession({
      sessionId: randomUUID(),
      kind: 'group',
      chatId,
      groupCallId,
      peerLabel: group.title || chat.title || 'Telegram video chat',
      direction: 'joined',
      isVideo,
      phase: 'connecting',
      durationSeconds: 0,
      microphoneMuted: false,
      cameraEnabled: isVideo,
      encryptionEmojis: [],
    });
    await this.options.invoke(
      { _: 'loadGroupCallParticipants', group_call_id: groupCallId, limit: 100 },
      'loadGroupCallParticipants',
    );
    return this.getState();
  }

  async leaveGroupCall(): Promise<TelegramCallState> {
    const session = this.state.session;
    if (!session || session.kind !== 'group' || !session.groupCallId) {
      return this.getState();
    }
    session.phase = 'hanging-up';
    this.emitSession();
    await Promise.allSettled([
      this.engine.request('stopSession'),
      this.options.invoke({ _: 'leaveGroupCall', group_call_id: session.groupCallId }, 'leaveGroupCall'),
    ]);
    this.finishSession('hung-up');
    return this.getState();
  }

  async setMuted(muted: boolean): Promise<TelegramCallState> {
    const session = this.requireSession();
    await this.engine.request('setMuted', { muted });
    session.microphoneMuted = muted;
    this.emitSession();
    return this.getState();
  }

  async setVideoEnabled(enabled: boolean): Promise<TelegramCallState> {
    const session = this.requireSession();
    if (enabled && !this.options.config.privateVideo && session.kind === 'private') {
      throw new Error('Telegram private video calls are disabled.');
    }
    await this.engine.request('setVideoEnabled', { enabled });
    session.cameraEnabled = enabled;
    session.isVideo ||= enabled;
    if (session.kind === 'group' && session.groupCallId) {
      await this.options.invoke(
        {
          _: 'toggleGroupCallIsMyVideoEnabled',
          group_call_id: session.groupCallId,
          is_my_video_enabled: enabled,
        },
        'toggleGroupCallIsMyVideoEnabled',
      );
    }
    this.emitSession();
    return this.getState();
  }

  async setDevice(kind: TelegramCallDevice['kind'], deviceId: string): Promise<TelegramCallState> {
    this.requireSession();
    await this.engine.request('setDevice', { kind, deviceId });
    this.state.devices = this.state.devices.map((device) => ({
      ...device,
      selected: device.kind === kind ? device.id === deviceId : device.selected,
    }));
    this.emit({ kind: 'devices', devices: this.state.devices.map((device) => ({ ...device })) });
    return this.getState();
  }

  async setParticipantVolume(participantId: string, volume: number): Promise<TelegramCallState> {
    const session = this.state.session;
    if (!session || session.kind !== 'group' || !session.groupCallId) {
      throw new Error('Participant volume is only available in a Telegram group call.');
    }
    const normalized = Math.max(1, Math.min(20_000, Math.round(volume)));
    await this.options.invoke(
      {
        _: 'setGroupCallParticipantVolumeLevel',
        group_call_id: session.groupCallId,
        participant_id: this.parseParticipantId(participantId),
        volume_level: normalized,
      },
      'setGroupCallParticipantVolumeLevel',
    );
    await this.engine.request('setParticipantVolume', { participantId, volume: normalized });
    return this.getState();
  }

  setVisibleVideoEndpoints(endpointIds: string[]): void {
    this.engine.send('setVisibleVideoEndpoints', {
      endpointIds: [...new Set(endpointIds)].slice(0, 16),
    });
  }

  async handleTdCall(call: TdCall): Promise<void> {
    const callId = call.id;
    if (!callId || !call.state) {
      return;
    }
    if (this.state.session && this.tdCallId && this.tdCallId !== callId) {
      await this.options.invoke(
        {
          _: 'discardCall',
          call_id: callId,
          is_disconnected: false,
          duration: 0,
          is_video: Boolean(call.is_video),
          connection_id: 0,
        },
        'discard simultaneous call',
      );
      return;
    }
    this.tdCallId = callId;
    if (!this.state.session) {
      if (call.is_outgoing) {
        return;
      }
      if (!this.options.config.privateVoice) {
        await this.options.invoke(
          { _: 'discardCall', call_id: callId, is_disconnected: false, duration: 0, is_video: Boolean(call.is_video), connection_id: 0 },
          'discard disabled incoming call',
        );
        return;
      }
      const userId = call.user_id ?? 0;
      const privateChat = userId
        ? await this.options.invoke<TdChat>(
            { _: 'createPrivateChat', user_id: userId, force: false },
            'createPrivateChat for incoming call',
          )
        : undefined;
      this.setSession({
        sessionId: randomUUID(),
        kind: 'private',
        chatId: privateChat?.id ? String(privateChat.id) : undefined,
        userId,
        peerLabel: userId ? await this.options.resolveUserLabel(userId) : 'Telegram caller',
        direction: 'incoming',
        isVideo: Boolean(call.is_video),
        phase: 'ringing',
        durationSeconds: 0,
        microphoneMuted: false,
        cameraEnabled: false,
        encryptionEmojis: [],
      });
    }
    await this.applyTdCallState(call.state);
  }

  handleSignalingData(callId: number | undefined, data: string | undefined): void {
    if (!callId || callId !== this.tdCallId || !data) {
      return;
    }
    this.engine.send('receiveSignalingData', { data });
  }

  async handleGroupCall(group: TdGroupCall): Promise<void> {
    const session = this.state.session;
    if (!session || session.kind !== 'group' || group.id !== session.groupCallId) {
      return;
    }
    if (group.need_rejoin) {
      session.phase = 'reconnecting';
      this.emitSession();
      this.engine.send('requestGroupRejoin');
    } else if (!group.is_active || !group.is_joined) {
      await this.stopEngineSession();
      this.finishSession('hung-up');
    }
  }

  async handleGroupParticipant(participant: TdGroupCallParticipant): Promise<void> {
    const session = this.state.session;
    if (!session || session.kind !== 'group') {
      return;
    }
    const mapped = await this.mapParticipant(participant);
    if (!mapped) {
      return;
    }
    const participants = new Map(this.state.participants.map((item) => [item.id, item]));
    if (!participant.order) {
      participants.delete(mapped.id);
    } else {
      participants.set(mapped.id, mapped);
    }
    this.state.participants = [...participants.values()];
    this.emit({ kind: 'participants', participants: this.state.participants.map((item) => ({ ...item })) });
    this.engine.send('updateGroupParticipants', {
      participants: this.state.participants,
    });
  }

  private async applyTdCallState(callState: TdCallState): Promise<void> {
    const session = this.state.session;
    if (!session || session.kind !== 'private') {
      return;
    }
    if (callState._ === 'callStatePending') {
      session.phase = 'ringing';
      this.emitSession();
      return;
    }
    if (callState._ === 'callStateExchangingKeys') {
      session.phase = 'connecting';
      this.emitSession();
      return;
    }
    if (callState._ === 'callStateReady') {
      session.phase = 'connecting';
      session.encryptionEmojis = [...(callState.emojis ?? [])];
      this.emitSession();
      await this.engine.request('startPrivateSession', {
        callId: this.tdCallId,
        isOutgoing: session.direction === 'outgoing',
        userId: session.userId,
        isVideo: session.isVideo,
        protocol: callState.protocol,
        servers: callState.servers ?? [],
        config: callState.config ?? '',
        encryptionKey: callState.encryption_key ?? '',
        allowP2p: Boolean(callState.allow_p2p),
        customParameters: callState.custom_parameters ?? '',
      });
      return;
    }
    if (callState._ === 'callStateHangingUp') {
      session.phase = 'hanging-up';
      this.emitSession();
      return;
    }
    if (callState._ === 'callStateError') {
      session.phase = 'failed';
      session.error = callState.error?.message || 'Telegram call failed.';
      this.emitSession();
      this.finishSession('error', session.error);
      return;
    }
    if (callState._ === 'callStateDiscarded') {
      await this.stopEngineSession();
      this.finishSession(terminalReason(callState.reason?._));
    }
  }

  private async handleEngineEvent(event: TelegramCallEngineEvent): Promise<void> {
    if (event.type === 'signaling') {
      if (this.tdCallId) {
        await this.options.invoke(
          { _: 'sendCallSignalingData', call_id: this.tdCallId, data: event.data },
          'sendCallSignalingData',
        );
      }
      return;
    }
    if (event.type === 'group-join-payload') {
      const session = this.state.session;
      if (!session || session.kind !== 'group' || !session.groupCallId) {
        return;
      }
      const info = await this.options.invoke<{ join_payload?: string }>(
        {
          _: 'joinVideoChat',
          group_call_id: session.groupCallId,
          participant_id: null,
          join_parameters: {
            _: 'groupCallJoinParameters',
            audio_source_id: event.audioSourceId,
            payload: event.payload,
            is_muted: session.microphoneMuted,
            is_my_video_enabled: session.cameraEnabled,
          },
          invite_hash: '',
        },
        'rejoinVideoChat',
      );
      await this.engine.request('setGroupJoinResponse', {
        payload: info.join_payload ?? '',
      });
      return;
    }
    if (event.type === 'state') {
      const session = this.state.session;
      if (!session) {
        return;
      }
      if (event.state === 'established') {
        session.phase = 'established';
        this.establishedAt = Date.now();
        session.startedAt = this.establishedAt;
        this.startDurationTimer();
      } else if (event.state === 'reconnecting') {
        session.phase = 'reconnecting';
      } else if (event.state === 'failed') {
        session.phase = 'failed';
        session.error = event.error || 'Telegram call engine failed.';
      } else {
        session.phase = 'connecting';
      }
      this.emitSession();
      if (event.state === 'failed') {
        await this.hangUp().catch(() => this.finishSession('error', session.error));
      }
      return;
    }
    if (event.type === 'devices') {
      this.state.devices = event.devices.map((device) => ({ ...device }));
      this.emit({ kind: 'devices', devices: this.state.devices });
      return;
    }
    if (event.type === 'participants') {
      this.state.participants = event.participants.map((participant) => ({ ...participant }));
      this.emit({ kind: 'participants', participants: this.state.participants });
      return;
    }
    if (event.type === 'metrics') {
      this.state.metrics = { ...event.metrics };
      this.emit({ kind: 'metrics', metrics: this.state.metrics });
      return;
    }
    if (event.type === 'video-frame') {
      if (
        event.width < 2 ||
        event.height < 2 ||
        event.width % 2 !== 0 ||
        event.height % 2 !== 0 ||
        event.width > 640 ||
        event.height > 360
      ) {
        return;
      }
      const bytes = Buffer.from(event.data, 'base64');
      const expectedBytes = event.width * event.height * 3 / 2;
      if (bytes.byteLength !== expectedBytes) {
        return;
      }
      const frame: TelegramCallVideoFrame = {
        endpointId: event.endpointId,
        width: event.width,
        height: event.height,
        timestamp: event.timestamp,
        data: new Uint8Array(bytes),
      };
      for (const listener of this.videoFrameListeners) {
        listener(frame);
      }
    }
  }

  private async endPrivateCall(isDisconnected: boolean): Promise<TelegramCallState> {
    const session = this.state.session;
    if (!session || session.kind !== 'private') {
      return this.getState();
    }
    session.phase = 'hanging-up';
    this.emitSession();
    const duration = this.currentDuration();
    await Promise.allSettled([
      this.engine.request('stopSession'),
      this.tdCallId
        ? this.options.invoke(
            {
              _: 'discardCall',
              call_id: this.tdCallId,
              is_disconnected: isDisconnected,
              duration,
              is_video: session.isVideo,
              connection_id: 0,
            },
            'discardCall',
          )
        : Promise.resolve(),
    ]);
    this.finishSession('hung-up');
    return this.getState();
  }

  private async getTdProtocol(): Promise<Record<string, unknown>> {
    if (!this.engineInfo) {
      this.engineInfo = await this.engine.getInfo();
    }
    return {
      _: 'callProtocol',
      udp_p2p: true,
      udp_reflector: true,
      min_layer: this.engineInfo.minLayer,
      max_layer: this.engineInfo.maxLayer,
      library_versions: this.engineInfo.libraryVersions,
    };
  }

  private assertPrivateFeature(isVideo: boolean): void {
    if (!this.options.config.privateVoice) {
      throw new Error('Telegram private voice calls are disabled.');
    }
    if (isVideo && !this.options.config.privateVideo) {
      throw new Error('Telegram private video calls are disabled.');
    }
  }

  private assertIdle(): void {
    if (this.state.session) {
      throw new Error('Another Telegram call is already active.');
    }
  }

  private requireSession(): TelegramCallSession {
    if (!this.state.session) {
      throw new Error('There is no active Telegram call.');
    }
    return this.state.session;
  }

  private requirePrivateSession(): TelegramCallSession {
    const session = this.requireSession();
    if (session.kind !== 'private') {
      throw new Error('The active Telegram call is not a private call.');
    }
    return session;
  }

  private setSession(session: TelegramCallSession): void {
    this.state.session = session;
    this.emitSession();
  }

  private emitSession(): void {
    this.emit({
      kind: 'session',
      session: this.state.session ? { ...this.state.session, encryptionEmojis: [...this.state.session.encryptionEmojis] } : null,
    });
  }

  private emit(update: TelegramCallUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }

  private finishSession(
    reason: Extract<TelegramCallUpdate, { kind: 'terminal' }>['reason'],
    error?: string,
  ): void {
    const sessionId = this.state.session?.sessionId;
    this.clearDurationTimer();
    this.resetState();
    if (sessionId) {
      this.emit({ kind: 'terminal', sessionId, reason, error });
    }
    this.emitSession();
  }

  private resetState(): void {
    this.state = cloneState(EMPTY_STATE);
    this.tdCallId = null;
    this.establishedAt = null;
  }

  private currentDuration(): number {
    if (!this.establishedAt) {
      return 0;
    }
    return Math.max(0, Math.floor((Date.now() - this.establishedAt) / 1000));
  }

  private startDurationTimer(): void {
    this.clearDurationTimer();
    this.durationTimer = setInterval(() => {
      if (!this.state.session) {
        return;
      }
      this.state.session.durationSeconds = this.currentDuration();
      this.emitSession();
    }, 1000);
    this.durationTimer.unref?.();
  }

  private clearDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private async stopEngineSession(): Promise<void> {
    try {
      await this.engine.request<Record<string, never>>('stopSession');
    } catch {
      // Teardown remains idempotent when the helper has already stopped.
    }
  }

  private parseParticipantId(id: string): Record<string, unknown> {
    const [kind, value] = id.split(':', 2);
    return kind === 'chat'
      ? { _: 'messageSenderChat', chat_id: Number(value) }
      : { _: 'messageSenderUser', user_id: Number(value) };
  }

  private async mapParticipant(
    participant: TdGroupCallParticipant,
  ): Promise<TelegramCallParticipant | null> {
    const sender = participant.participant_id;
    const numericId = sender?.user_id ?? sender?.chat_id;
    if (!sender || !numericId) {
      return null;
    }
    const id = sender.user_id ? `user:${numericId}` : `chat:${numericId}`;
    return {
      id,
      displayName: sender.user_id
        ? await this.options.resolveUserLabel(sender.user_id)
        : `Chat ${numericId}`,
      audioSourceId: participant.audio_source_id,
      speaking: Boolean(participant.is_speaking),
      muted: Boolean(
        participant.is_muted_for_all_users || participant.is_muted_for_current_user,
      ),
      volume: participant.volume_level ?? 10_000,
      isCurrentUser: Boolean(participant.is_current_user),
      videoEndpointId: participant.video_info?.endpoint_id,
      videoSourceGroups: participant.video_info?.source_groups?.map((group) => ({
        semantics: group.semantics ?? '',
        sourceIds: [...(group.source_ids ?? [])],
      })),
      screenEndpointId: participant.screen_sharing_video_info?.endpoint_id,
      videoPaused: participant.video_info?.is_paused,
    };
  }
}
