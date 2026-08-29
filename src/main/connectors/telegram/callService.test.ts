import { describe, expect, it } from 'vitest';
import type { TelegramCallEngine } from './callEngine';
import { TelegramCallService } from './callService';

const createEngine = (): TelegramCallEngine & { commands: string[] } => {
  return {
    commands: [],
    onEvent() {
      return () => undefined;
    },
    async getInfo() {
      return {
        protocolVersion: 1,
        libraryVersions: ['13.0.0'],
        minLayer: 65,
        maxLayer: 92,
        supportsPrivateVideo: true,
        supportsGroupCalls: true,
      };
    },
    async request<T>(command: string): Promise<T> {
      this.commands.push(command);
      return {} as T;
    },
    send(command: string) {
      this.commands.push(command);
    },
    stop() {
      return Promise.resolve();
    },
  };
};

describe('TelegramCallService', () => {
  it('creates an outgoing call with the engine protocol versions', async () => {
    const engine = createEngine();
    const requests: Record<string, unknown>[] = [];
    const service = new TelegramCallService({
      config: { privateVoice: true, privateVideo: true, group: true },
      engine,
      getClient: () => null,
      resolveUserLabel: async () => 'Ada',
      invoke: async <T>(request: Record<string, unknown>): Promise<T> => {
        requests.push(request);
        if (request._ === 'getChat') {
          return {
            id: 100,
            title: 'Ada',
            type: { _: 'chatTypePrivate', user_id: 42 },
          } as T;
        }
        if (request._ === 'getUserFullInfo') {
          return {
            can_be_called: true,
            supports_video_calls: true,
            has_private_calls: false,
          } as T;
        }
        return { id: 7 } as T;
      },
    });

    const state = await service.startPrivateCall('100', true);

    expect(state.session).toMatchObject({
      chatId: '100',
      userId: 42,
      direction: 'outgoing',
      isVideo: true,
      phase: 'ringing',
    });
    expect(requests.at(-1)).toMatchObject({
      _: 'createCall',
      user_id: 42,
      protocol: {
        max_layer: 92,
        library_versions: ['13.0.0'],
      },
    });
  });

  it('rejects a simultaneous incoming call as busy without replacing the session', async () => {
    const engine = createEngine();
    const requests: Array<{ request: Record<string, unknown>; label: string }> = [];
    const invoke = async <T>(
      request: Record<string, unknown>,
      label: string,
    ): Promise<T> => {
      requests.push({ request, label });
      if (request._ === 'createPrivateChat') {
        return { id: 100, title: 'Ada' } as T;
      }
      return {} as T;
    };
    const service = new TelegramCallService({
      config: { privateVoice: true, privateVideo: true, group: true },
      engine,
      getClient: () => null,
      resolveUserLabel: async (userId) => (userId === 42 ? 'Ada' : 'Grace'),
      invoke,
    });

    await service.handleTdCall({
      id: 1,
      user_id: 42,
      is_outgoing: false,
      is_video: false,
      state: { _: 'callStatePending' },
    });
    await service.handleTdCall({
      id: 2,
      user_id: 43,
      is_outgoing: false,
      is_video: false,
      state: { _: 'callStatePending' },
    });

    expect(service.getState().session?.peerLabel).toBe('Ada');
    expect(requests).toContainEqual(
      expect.objectContaining({
        request: expect.objectContaining({ _: 'discardCall', call_id: 2 }),
        label: 'discard simultaneous call',
      }),
    );
  });

  it('never exposes encryption keys in renderer updates', async () => {
    const engine = createEngine();
    const updates: unknown[] = [];
    const service = new TelegramCallService({
      config: { privateVoice: true, privateVideo: true, group: false },
      engine,
      getClient: () => null,
      resolveUserLabel: async () => 'Ada',
      invoke: async <T>(request: Record<string, unknown>): Promise<T> =>
        (request._ === 'createPrivateChat' ? { id: 100, title: 'Ada' } : {}) as T,
    });
    service.onUpdate((update) => updates.push(update));

    await service.handleTdCall({
      id: 1,
      user_id: 42,
      is_outgoing: false,
      is_video: false,
      state: {
        _: 'callStateReady',
        encryption_key: 'super-secret',
        emojis: ['🔑'],
      },
    });

    expect(JSON.stringify(updates)).not.toContain('super-secret');
    expect(service.getState().session?.encryptionEmojis).toEqual(['🔑']);
  });
});
