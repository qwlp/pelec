import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { OutgoingAttachmentDocument } from '../../../shared/connectors';
import type {
  InstagramAuthResult,
  InstagramBroadcastResponse,
  InstagramCurrentUserResponse,
  InstagramInboxResponse,
  InstagramMessageItem,
  InstagramMetaState,
  InstagramRealtimeStatus,
  InstagramRuntimeEvent,
  InstagramThread,
  InstagramThreadResponse,
} from './types';

type InstagramChallengeState = {
  step_name?: string;
  step_data?: {
    contact_point?: string;
  };
};

type InstagramState = {
  authorization?: string;
  constants?: {
    HOST?: string;
  };
  cookieJar?: {
    getCookies(uri: string): Array<{ key?: string; value?: string }>;
    setCookie(cookieOrStr: string, uri: string): unknown;
  };
  checkpoint?: unknown;
  cookieUserId?: string;
  deserialize(value: Record<string, unknown>): Promise<void>;
  generateDevice(seed: string): void;
  serialize(): Promise<Record<string, unknown>>;
  phoneId?: string;
};

type InstagramClient = {
  account: {
    currentUser(): Promise<InstagramCurrentUserResponse['user']>;
    login(username: string, password: string): Promise<void>;
    twoFactorLogin(input: {
      username: string;
      verificationCode: string;
      twoFactorIdentifier: string;
      verificationMethod: string;
    }): Promise<void>;
  };
  challenge: {
    auto(review: boolean): Promise<InstagramChallengeState | undefined>;
    sendSecurityCode(code: string): Promise<void>;
  };
  entity: {
    directThread(threadId: string): {
      broadcastText(
        text: string,
        replyToMessage?: InstagramMessageItem,
        skipLinkCheck?: boolean,
      ): Promise<InstagramBroadcastResponse>;
      broadcastPhoto(options: { file: Buffer }): Promise<InstagramBroadcastResponse>;
      broadcastVideo(options: { video: Buffer }): Promise<InstagramBroadcastResponse>;
      deleteItem(itemId: string): Promise<unknown>;
      markItemSeen(itemId: string): Promise<unknown>;
    };
  };
  feed: {
    directInbox(): {
      items(): Promise<InstagramThread[]>;
      request?(): Promise<unknown>;
      isMoreAvailable?(): boolean;
      cursor?: string;
    };
    directThread(input: { thread_id: string; oldest_cursor?: string }): {
      items(): Promise<InstagramMessageItem[]>;
      request(): Promise<{ thread?: Record<string, unknown> }>;
      cursor?: string;
    };
    reelsTray?(reason?: string): {
      request(): Promise<unknown>;
    };
    timeline?(reason?: string): {
      request(): Promise<unknown>;
    };
  };
  launcher?: {
    preLoginSync(): Promise<void>;
  };
  request: {
    end$: {
      subscribe(listener: () => void): void;
    };
  };
  simulate?: {
    postLoginFlow(): Promise<void>;
    preLoginFlow(): Promise<void>;
  };
  state: InstagramState;
};

type InstagramPrivateApiModule = {
  IgApiClient: new () => InstagramClient;
};

type InstagramMqttModule = {
  IgApiClientExt?: new () => InstagramClient;
  withRealtime(client: InstagramClient): {
    realtime: {
      on(event: 'error' | 'close' | 'message', listener: (...args: unknown[]) => void): void;
      connect(options: {
        graphQlSubs: unknown[];
        skywalkerSubs: unknown[];
        irisData?: unknown;
      }): Promise<void>;
      direct?: {
        markAsSeen?(input: { threadId: string; itemId: string }): Promise<void>;
      };
    };
  };
  GraphQLSubscriptions: {
    getAppPresenceSubscription(): unknown;
    getZeroProvisionSubscription(phoneId?: string): unknown;
    getDirectStatusSubscription(): unknown;
    getDirectTypingSubscription(userId?: string): unknown;
    getAsyncAdSubscription(userId?: string): unknown;
  };
  SkywalkerSubscriptions: {
    directSub(userId?: string): unknown;
    liveSub(userId?: string): unknown;
  };
};

type InstagramLoginError = {
  response?: {
    body?: {
      two_factor_info?: {
        totp_two_factor_on?: unknown;
        two_factor_identifier?: unknown;
      };
    };
  };
};

type ActiveInstagramClientState = {
  emitter: EventEmitter;
  currentUser?: InstagramCurrentUserResponse['user'];
  ig: InstagramClient;
  partition: string;
  realtime?: {
    on(event: 'error' | 'close' | 'message', listener: (...args: unknown[]) => void): void;
    connect(options: {
      graphQlSubs: unknown[];
      skywalkerSubs: unknown[];
      irisData?: unknown;
    }): Promise<void>;
    direct?: {
      markAsSeen?(input: { threadId: string; itemId: string }): Promise<void>;
    };
  };
  realtimeInitPromise?: Promise<void>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  realtimeStatus: InstagramRealtimeStatus;
  username: string;
};

const nodeRequire = createRequire(__filename);
const activeClients = new Map<string, ActiveInstagramClientState>();
const partitionRuntimeEmitters = new Map<string, EventEmitter>();
const partitionRealtimeStatuses = new Map<string, InstagramRealtimeStatus>();

const getPartitionEmitter = (partition: string): EventEmitter => {
  let emitter = partitionRuntimeEmitters.get(partition);
  if (!emitter) {
    emitter = new EventEmitter();
    partitionRuntimeEmitters.set(partition, emitter);
  }
  return emitter;
};

const toPartitionKey = (partition: string): string => partition.replace(/[^a-zA-Z0-9_-]/g, '_');

const getStateRoot = (userDataPath: string, partition: string): string =>
  path.join(userDataPath, 'instagram-native', toPartitionKey(partition));

const getMetaPath = (userDataPath: string, partition: string): string =>
  path.join(getStateRoot(userDataPath, partition), 'meta.json');

const getPendingTwoFactorSessionPath = (userDataPath: string, partition: string): string =>
  path.join(getStateRoot(userDataPath, partition), 'pending-two-factor-session.json');

const getPendingChallengeSessionPath = (userDataPath: string, partition: string): string =>
  path.join(getStateRoot(userDataPath, partition), 'pending-challenge-session.json');

const getSessionPath = (userDataPath: string, partition: string, username: string): string =>
  path.join(getStateRoot(userDataPath, partition), 'users', username, 'session.json');

const readJsonFile = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const clearPendingTwoFactorSession = async (
  userDataPath: string,
  partition: string,
): Promise<void> => {
  try {
    await unlink(getPendingTwoFactorSessionPath(userDataPath, partition));
  } catch {
    // Best-effort cleanup.
  }
};

const clearPendingChallengeSession = async (
  userDataPath: string,
  partition: string,
): Promise<void> => {
  try {
    await unlink(getPendingChallengeSessionPath(userDataPath, partition));
  } catch {
    // Best-effort cleanup.
  }
};

const hasCheckpointState = (state: Record<string, unknown> | undefined): boolean =>
  Boolean(state && typeof state === 'object' && state.checkpoint);

const getMetaState = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramMetaState> =>
  (await readJsonFile<InstagramMetaState>(getMetaPath(userDataPath, partition))) ?? {};

const saveMetaState = async (
  userDataPath: string,
  partition: string,
  meta: InstagramMetaState,
): Promise<void> => {
  await writeJsonFile(getMetaPath(userDataPath, partition), meta);
};

const loadInstagramModule = async (): Promise<InstagramPrivateApiModule> => {
  try {
    return nodeRequire('instagram-private-api') as InstagramPrivateApiModule;
  } catch {
    throw new Error(
      'Instagram native dependency missing: install "instagram-private-api" in the app project.',
    );
  }
};

const loadInstagramMqttModule = async (): Promise<InstagramMqttModule> => {
  try {
    return nodeRequire('instagram_mqtt') as InstagramMqttModule;
  } catch {
    throw new Error('Instagram realtime dependency missing: install "instagram_mqtt" in the app project.');
  }
};

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof AggregateError) {
    const messages = Array.from(error.errors ?? [])
      .map((entry) => formatErrorMessage(entry))
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join(' | ');
    }
  }
  if (error instanceof Error) {
    return error.message || error.name || 'Error';
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const parseAuthorizationSession = (
  authorization: string | undefined,
): { sessionId?: string; userId?: string } | undefined => {
  if (!authorization?.startsWith('Bearer IGT:2:')) {
    return undefined;
  }

  const raw = authorization.slice('Bearer IGT:2:'.length);
  const tryDecode = (encoding: BufferEncoding | 'base64url'): string | undefined => {
    try {
      return Buffer.from(raw, encoding).toString('utf8');
    } catch {
      return undefined;
    }
  };

  const decoded = tryDecode('base64url') ?? tryDecode('base64');
  if (!decoded) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(decoded) as {
      ds_user_id?: string;
      sessionid?: string;
    };
    return {
      sessionId: parsed.sessionid,
      userId: parsed.ds_user_id,
    };
  } catch {
    return undefined;
  }
};

const ensureSessionCookies = async (
  ig: InstagramClient,
  username?: string,
): Promise<boolean> => {
  const host = ig.state.constants?.HOST ?? 'https://i.instagram.com';
  const existingCookies = ig.state.cookieJar?.getCookies(host) ?? [];
  const hasSessionId = existingCookies.some((cookie) => cookie.key === 'sessionid' && cookie.value);
  const hasUserId = existingCookies.some((cookie) => cookie.key === 'ds_user_id' && cookie.value);
  if (hasSessionId && hasUserId) {
    return false;
  }

  const parsed = parseAuthorizationSession(ig.state.authorization);
  if (!parsed?.sessionId || !parsed.userId || !ig.state.cookieJar) {
    return false;
  }

  ig.state.cookieJar.setCookie(
    `sessionid=${parsed.sessionId}; Domain=.instagram.com; Path=/; Secure; HttpOnly`,
    host,
  );
  ig.state.cookieJar.setCookie(
    `ds_user_id=${parsed.userId}; Domain=.instagram.com; Path=/; Secure`,
    host,
  );
  if (username?.trim()) {
    ig.state.cookieJar.setCookie(
      `ds_user=${username.trim()}; Domain=.instagram.com; Path=/; Secure`,
      host,
    );
  }
  return true;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const resolveCurrentUser = async (
  ig: InstagramClient,
  timeoutMs = 8000,
): Promise<InstagramCurrentUserResponse['user']> =>
  withTimeout(ig.account.currentUser(), timeoutMs, 'Timed out fetching Instagram current user.');

const createActiveClientState = (
  partition: string,
  ig: InstagramClient,
  username: string,
  currentUser?: InstagramCurrentUserResponse['user'],
): ActiveInstagramClientState => ({
  emitter: getPartitionEmitter(partition),
  currentUser,
  ig,
  partition,
  realtimeStatus: 'disconnected',
  username,
});

const setRealtimeStatus = (
  state: ActiveInstagramClientState,
  status: InstagramRealtimeStatus,
): void => {
  state.realtimeStatus = status;
  partitionRealtimeStatuses.set(state.partition, status);
  state.emitter.emit('runtime', {
    kind: 'realtime-status',
    status,
  } satisfies InstagramRuntimeEvent);
};

const createIgClient = async (
  userDataPath: string,
  partition: string,
  username: string,
): Promise<InstagramClient> => {
  const mqttModule = await loadInstagramMqttModule();
  const igModule = await loadInstagramModule();
  const ClientCtor = mqttModule.IgApiClientExt ?? igModule.IgApiClient;
  const ig = new ClientCtor();
  ig.state.generateDevice(username);
  ig.request.end$.subscribe(() => {
    void persistSessionState(userDataPath, partition, username, ig);
  });
  return ig;
};

const persistSessionState = async (
  userDataPath: string,
  partition: string,
  username: string,
  ig: InstagramClient,
): Promise<void> => {
  await ensureSessionCookies(ig, username);
  const serialized = await ig.state.serialize();
  const { constants, ...stateToSave } = serialized as Record<string, unknown>;
  void constants;
  await writeJsonFile(getSessionPath(userDataPath, partition, username), stateToSave);
};

const safePreLoginFlow = async (ig: InstagramClient): Promise<void> => {
  try {
    if (ig.launcher?.preLoginSync) {
      await ig.launcher.preLoginSync();
      return;
    }
  } catch {
    // Fall through to simulate flow.
  }

  try {
    await ig.simulate?.preLoginFlow?.();
  } catch {
    // Non-fatal.
  }
};

const safePostLoginFlow = async (ig: InstagramClient): Promise<void> => {
  try {
    if (ig.feed.reelsTray && ig.feed.timeline) {
      await ig.feed.reelsTray('cold_start').request();
      await ig.feed.timeline('cold_start_fetch').request();
      return;
    }
  } catch {
    // Fall through to simulate flow.
  }

  try {
    await ig.simulate?.postLoginFlow?.();
  } catch {
    // Non-fatal.
  }
};

const emitThreadEvent = (
  state: ActiveInstagramClientState,
  kind: 'message' | 'reaction' | 'seen',
  threadId: string,
): void => {
  state.emitter.emit('runtime', {
    kind,
    threadId,
  } satisfies InstagramRuntimeEvent);
};

const clearRealtimeReconnectTimer = (state: ActiveInstagramClientState): void => {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = undefined;
  }
};

const scheduleRealtimeReconnect = (
  state: ActiveInstagramClientState,
  delayMs = 2500,
): void => {
  clearRealtimeReconnectTimer(state);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = undefined;
    if (activeClients.get(state.partition) !== state) {
      return;
    }
    void ensureRealtimeConnected(state).catch((error) => {
      console.error('[instagram-realtime] reconnect failed', error);
    });
  }, delayMs);
};

const ensureRealtimeConnected = async (
  state: ActiveInstagramClientState,
): Promise<void> => {
  if (state.realtime && state.realtimeStatus === 'connected') {
    return;
  }
  if (state.realtimeInitPromise) {
    await state.realtimeInitPromise;
    return;
  }

  clearRealtimeReconnectTimer(state);
  state.realtimeInitPromise = (async () => {
    const mqtt = await loadInstagramMqttModule();
    setRealtimeStatus(state, 'connecting');
    const realtime = mqtt.withRealtime(state.ig).realtime;
    state.realtime = realtime;

    realtime.on('error', (error: unknown) => {
      console.error('[instagram-realtime] error', error);
      state.realtime = undefined;
      setRealtimeStatus(state, 'error');
      scheduleRealtimeReconnect(state);
    });

    realtime.on('close', () => {
      state.realtime = undefined;
      setRealtimeStatus(state, 'disconnected');
      scheduleRealtimeReconnect(state);
    });

    realtime.on('message', (wrapper: unknown) => {
      const payload = wrapper as {
        delta_type?: string;
        message?: {
          action_type?: string;
          thread_id?: string;
          thread_v2_id?: string;
        };
      };
      const threadId = payload.message?.thread_id ?? payload.message?.thread_v2_id;
      if (!threadId) {
        return;
      }

      if (payload.delta_type === 'deltaCreateReaction' && payload.message?.action_type !== 'action_log') {
        emitThreadEvent(state, 'reaction', threadId);
        return;
      }
      if (payload.delta_type === 'deltaReadReceipt') {
        emitThreadEvent(state, 'seen', threadId);
        return;
      }
      if (payload.delta_type === 'deltaNewMessage') {
        emitThreadEvent(state, 'message', threadId);
      }
    });

    const irisData = await state.ig.feed.directInbox().request?.();
    await realtime.connect({
      graphQlSubs: [
        mqtt.GraphQLSubscriptions.getAppPresenceSubscription(),
        mqtt.GraphQLSubscriptions.getZeroProvisionSubscription(state.ig.state.phoneId),
        mqtt.GraphQLSubscriptions.getDirectStatusSubscription(),
        mqtt.GraphQLSubscriptions.getDirectTypingSubscription(state.ig.state.cookieUserId),
        mqtt.GraphQLSubscriptions.getAsyncAdSubscription(state.ig.state.cookieUserId),
      ],
      skywalkerSubs: [
        mqtt.SkywalkerSubscriptions.directSub(state.ig.state.cookieUserId),
        mqtt.SkywalkerSubscriptions.liveSub(state.ig.state.cookieUserId),
      ],
      irisData,
    });

    setRealtimeStatus(state, 'connected');
  })().catch((error) => {
    state.realtime = undefined;
    setRealtimeStatus(state, 'error');
    scheduleRealtimeReconnect(state);
    throw error;
  });

  try {
    await state.realtimeInitPromise;
  } finally {
    state.realtimeInitPromise = undefined;
  }
};

const warmSessionClient = async (
  userDataPath: string,
  partition: string,
): Promise<ActiveInstagramClientState | undefined> => {
  const cached = activeClients.get(partition);
  if (cached) {
    return cached;
  }

  const meta = await getMetaState(userDataPath, partition);
  const username = meta.currentUsername;
  if (!username) {
    return undefined;
  }

  const sessionState = await readJsonFile<Record<string, unknown>>(
    getSessionPath(userDataPath, partition, username),
  );
  if (!sessionState) {
    return undefined;
  }

  const ig = await createIgClient(userDataPath, partition, username);
  await ig.state.deserialize(sessionState);
  const repairedCookies = await ensureSessionCookies(ig, username);
  const resolvedUsername = username;
  if (repairedCookies) {
    await persistSessionState(userDataPath, partition, resolvedUsername, ig);
  }
  const state = createActiveClientState(partition, ig, resolvedUsername);
  activeClients.set(partition, state);

  await saveMetaState(userDataPath, partition, {
    currentUsername: resolvedUsername,
    pendingTwoFactor: undefined,
    pendingChallenge: undefined,
  });

  void ensureRealtimeConnected(state).catch((error) => {
    console.error('[instagram-realtime] session warm failed', error);
  });

  return state;
};

const requireAuthedState = async (
  userDataPath: string,
  partition: string,
): Promise<ActiveInstagramClientState> => {
  const hydrated = await warmSessionClient(userDataPath, partition);
  if (!hydrated) {
    throw new Error('Instagram session is not authenticated.');
  }
  return hydrated;
};

const isCheckpointError = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return lowered.includes('checkpoint_required') || lowered.includes('checkpoint required');
};

const clearPendingChallengeArtifacts = async (
  userDataPath: string,
  partition: string,
  meta?: InstagramMetaState,
): Promise<void> => {
  await clearPendingChallengeSession(userDataPath, partition);
  const nextMeta = meta ?? (await getMetaState(userDataPath, partition));
  await saveMetaState(userDataPath, partition, {
    ...nextMeta,
    pendingChallenge: undefined,
  });
};

const isChallengeCodeStep = (stepName?: string): boolean => {
  const normalized = (stepName ?? '').toLowerCase();
  return (
    normalized.includes('verify') ||
    normalized.includes('security_code') ||
    normalized.includes('submit_phone') ||
    normalized.includes('submit_code')
  );
};

const finalizeLoggedInState = async (
  userDataPath: string,
  partition: string,
  normalizedUsername: string,
  ig: InstagramClient,
): Promise<InstagramAuthResult> => {
  await ensureSessionCookies(ig, normalizedUsername);
  const currentUser = await resolveCurrentUser(ig);
  const resolvedUsername = String(currentUser?.username || normalizedUsername);

  await persistSessionState(userDataPath, partition, resolvedUsername, ig);
  await saveMetaState(userDataPath, partition, {
    currentUsername: resolvedUsername,
    pendingTwoFactor: undefined,
    pendingChallenge: undefined,
  });
  await clearPendingTwoFactorSession(userDataPath, partition);
  await clearPendingChallengeSession(userDataPath, partition);

  const state = createActiveClientState(partition, ig, resolvedUsername, currentUser);
  activeClients.set(partition, state);
  void ensureRealtimeConnected(state).catch((error) => {
    console.error('[instagram-realtime] login init failed', error);
  });

  return {
    ok: true,
    username: resolvedUsername,
    details: `Instagram login successful for @${resolvedUsername}.`,
  };
};

const dataUrlToBuffer = (value: string): Buffer => {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/u.exec(value);
  if (!match) {
    throw new Error('Expected a base64 data URL.');
  }
  return Buffer.from(match[2], 'base64');
};

const findReplyTarget = async (
  ig: InstagramClient,
  threadId: string,
  replyToMessageId?: string,
): Promise<InstagramMessageItem | undefined> => {
  if (!replyToMessageId) {
    return undefined;
  }
  try {
    const items = await ig.feed.directThread({ thread_id: threadId }).items();
    return items.find((item) => item.item_id === replyToMessageId);
  } catch {
    return undefined;
  }
};

const extractItemId = (result: InstagramBroadcastResponse): string | undefined =>
  result.payload?.item_id ?? result.item_id;

export const resetInstagramAuthState = async (
  userDataPath: string,
  partition: string,
): Promise<void> => {
  const existing = activeClients.get(partition);
  if (existing) {
    clearRealtimeReconnectTimer(existing);
  }
  activeClients.delete(partition);
  partitionRealtimeStatuses.set(partition, 'disconnected');
  await rm(getStateRoot(userDataPath, partition), { recursive: true, force: true });
};

export const verifyInstagramCapability = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramAuthResult> => {
  try {
    const hydrated = await warmSessionClient(userDataPath, partition);
    if (!hydrated) {
      const meta = await getMetaState(userDataPath, partition);
      if (meta.pendingTwoFactor) {
        return {
          ok: false,
          requiresTwoFactor: true,
          username: meta.pendingTwoFactor.username,
          details: 'Instagram requires a 2FA code to complete login.',
        };
      }
      if (meta.pendingChallenge) {
        const pendingState = await readJsonFile<Record<string, unknown>>(
          getPendingChallengeSessionPath(userDataPath, partition),
        );
        if (!hasCheckpointState(pendingState)) {
          await clearPendingChallengeArtifacts(userDataPath, partition, meta);
          return {
            ok: false,
            details:
              'Instagram checkpoint session expired. Complete the challenge in Instagram browser/app, then retry auth.',
          };
        }
        const target = meta.pendingChallenge.contactPoint
          ? ` sent to ${meta.pendingChallenge.contactPoint}`
          : ' from Instagram via email, SMS, or the Instagram app/browser';
        return {
          ok: false,
          requiresChallenge: true,
          username: meta.pendingChallenge.username,
          details: `Instagram requires a security challenge code${target} to complete login.`,
        };
      }
      return {
        ok: false,
        details: 'No stored Instagram session found.',
      };
    }

    return {
      ok: true,
      username: hydrated.username,
      details: `Instagram native session active for @${hydrated.username}.`,
    };
  } catch (error) {
    const message = formatErrorMessage(error) || 'Unable to verify Instagram native capability.';
    if (isCheckpointError(message)) {
      return {
        ok: false,
        details:
          'Instagram checkpoint required. Complete the security challenge in the Instagram browser/app first, then retry auth.',
      };
    }
    return {
      ok: false,
      details: message,
    };
  }
};

export const loginInstagram = async (
  userDataPath: string,
  partition: string,
  username: string,
  password: string,
): Promise<InstagramAuthResult> => {
  const normalizedUsername = username.trim();
  if (!normalizedUsername || !password.trim()) {
    return {
      ok: false,
      details: 'Username and password are required.',
    };
  }

  const ig = await createIgClient(userDataPath, partition, normalizedUsername);
  await safePreLoginFlow(ig);

  try {
    await ig.account.login(normalizedUsername, password);
    await safePostLoginFlow(ig);
    return finalizeLoggedInState(userDataPath, partition, normalizedUsername, ig);
  } catch (error: unknown) {
    const loginError = error as InstagramLoginError;
    const twoFactorInfo = loginError.response?.body?.two_factor_info;
    if (twoFactorInfo?.two_factor_identifier) {
      const serialized = await ig.state.serialize();
      const { constants, ...pendingState } = serialized as Record<string, unknown>;
      void constants;
      await writeJsonFile(getPendingTwoFactorSessionPath(userDataPath, partition), pendingState);
      await saveMetaState(userDataPath, partition, {
        currentUsername: undefined,
        pendingTwoFactor: {
          username: normalizedUsername,
          twoFactorIdentifier: String(twoFactorInfo.two_factor_identifier),
          totpTwoFactorOn: Boolean(twoFactorInfo.totp_two_factor_on),
        },
        pendingChallenge: undefined,
      });
      return {
        ok: false,
        requiresTwoFactor: true,
        username: normalizedUsername,
        details: 'Instagram requires a 2FA code. Submit the code to continue.',
      };
    }

    const message = formatErrorMessage(error) || 'Instagram login failed.';
    if (isCheckpointError(message)) {
      if (!ig.state.checkpoint) {
        return {
          ok: false,
          details:
            'Instagram checkpoint requires browser/app review. Complete the challenge outside the app and retry auth.',
        };
      }
      let challengeState: InstagramChallengeState | undefined;
      try {
        challengeState = await ig.challenge.auto(true);
      } catch {
        // Continue; the checkpoint session may still be recoverable.
      }

      const stepName = String(challengeState?.step_name || '').trim() || undefined;
      const contactPoint = String(challengeState?.step_data?.contact_point || '').trim() || undefined;
      if (stepName && !isChallengeCodeStep(stepName)) {
        return {
          ok: false,
          details:
            `Instagram checkpoint requires interactive review (${stepName}). Complete it in the Instagram browser/app, then retry auth.`,
        };
      }

      const serialized = await ig.state.serialize();
      if (!hasCheckpointState(serialized as Record<string, unknown>)) {
        return {
          ok: false,
          details:
            'Instagram checkpoint could not be resumed natively. Complete the challenge in the browser/app, then retry auth.',
        };
      }
      const { constants, ...pendingState } = serialized as Record<string, unknown>;
      void constants;
      await writeJsonFile(getPendingChallengeSessionPath(userDataPath, partition), pendingState);
      await saveMetaState(userDataPath, partition, {
        currentUsername: undefined,
        pendingTwoFactor: undefined,
        pendingChallenge: {
          username: normalizedUsername,
          stepName,
          contactPoint,
        },
      });
      const target = contactPoint
        ? ` sent to ${contactPoint}`
        : ' from Instagram via email, SMS, or the Instagram browser/app';
      return {
        ok: false,
        requiresChallenge: true,
        username: normalizedUsername,
        details: `Instagram checkpoint required. Enter the security code${target} to complete login.`,
      };
    }

    const lowered = message.toLowerCase();
    if (lowered.includes('password')) {
      return {
        ok: false,
        details: 'Instagram rejected the password. Check credentials and try again.',
      };
    }

    return {
      ok: false,
      details: message,
    };
  }
};

export const submitInstagramTwoFactorCode = async (
  userDataPath: string,
  partition: string,
  verificationCode: string,
): Promise<InstagramAuthResult> => {
  const code = verificationCode.trim();
  if (!code) {
    return {
      ok: false,
      requiresTwoFactor: true,
      details: '2FA code is required.',
    };
  }

  const meta = await getMetaState(userDataPath, partition);
  const pending = meta.pendingTwoFactor;
  if (!pending) {
    return {
      ok: false,
      details: 'No pending Instagram 2FA challenge found.',
    };
  }

  const ig = await createIgClient(userDataPath, partition, pending.username);
  const pendingState = await readJsonFile<Record<string, unknown>>(
    getPendingTwoFactorSessionPath(userDataPath, partition),
  );
  if (pendingState) {
    await ig.state.deserialize(pendingState);
  } else {
    await safePreLoginFlow(ig);
  }

  try {
    const primaryMethod = pending.totpTwoFactorOn ? '0' : '1';
    const fallbackMethod = primaryMethod === '0' ? '1' : '0';
    try {
      await ig.account.twoFactorLogin({
        username: pending.username,
        verificationCode: code,
        twoFactorIdentifier: pending.twoFactorIdentifier,
        verificationMethod: primaryMethod,
      });
    } catch (primaryError) {
      const message = formatErrorMessage(primaryError).toLowerCase();
      const shouldRetryAlternateMethod =
        message.includes('400') || message.includes('two_factor') || message.includes('security code');
      if (!shouldRetryAlternateMethod) {
        throw primaryError;
      }
      await ig.account.twoFactorLogin({
        username: pending.username,
        verificationCode: code,
        twoFactorIdentifier: pending.twoFactorIdentifier,
        verificationMethod: fallbackMethod,
      });
    }

    await safePostLoginFlow(ig);
    return finalizeLoggedInState(userDataPath, partition, pending.username, ig);
  } catch (error) {
    const message = formatErrorMessage(error) || 'Instagram 2FA verification failed.';
    if (isCheckpointError(message)) {
      return {
        ok: false,
        username: pending.username,
        details:
          'Instagram checkpoint required after 2FA. Complete the challenge in the Instagram browser/app, then retry auth.',
      };
    }
    return {
      ok: false,
      requiresTwoFactor: true,
      username: pending.username,
      details: message,
    };
  }
};

export const submitInstagramChallengeCode = async (
  userDataPath: string,
  partition: string,
  securityCode: string,
): Promise<InstagramAuthResult> => {
  const code = securityCode.trim();
  if (!code) {
    return {
      ok: false,
      requiresChallenge: true,
      details: 'Challenge code is required.',
    };
  }

  const meta = await getMetaState(userDataPath, partition);
  const pending = meta.pendingChallenge;
  if (!pending) {
    return {
      ok: false,
      details: 'No pending Instagram challenge found.',
    };
  }

  const ig = await createIgClient(userDataPath, partition, pending.username);
  const pendingState = await readJsonFile<Record<string, unknown>>(
    getPendingChallengeSessionPath(userDataPath, partition),
  );
  if (!hasCheckpointState(pendingState)) {
    await clearPendingChallengeArtifacts(userDataPath, partition, meta);
    return {
      ok: false,
      details:
        'Instagram checkpoint session expired. Complete the challenge in Instagram browser/app, then retry auth.',
    };
  }
  if (pendingState) {
    await ig.state.deserialize(pendingState);
  }
  if (!ig.state.checkpoint) {
    await clearPendingChallengeArtifacts(userDataPath, partition, meta);
    return {
      ok: false,
      details:
        'Instagram checkpoint session expired. Complete the challenge in Instagram browser/app, then retry auth.',
    };
  }

  try {
    await ig.challenge.sendSecurityCode(code);
    await safePostLoginFlow(ig);
    return finalizeLoggedInState(userDataPath, partition, pending.username, ig);
  } catch (error) {
    const message = formatErrorMessage(error) || 'Instagram challenge verification failed.';
    if (isCheckpointError(message)) {
      return {
        ok: false,
        requiresChallenge: true,
        username: pending.username,
        details: 'Instagram challenge code was rejected. Check the code and try again.',
      };
    }
    return {
      ok: false,
      requiresChallenge: true,
      username: pending.username,
      details: message,
    };
  }
};

export const fetchInbox = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramInboxResponse> => {
  const state = await requireAuthedState(userDataPath, partition);
  const threads = (await state.ig.feed.directInbox().items()) as InstagramThread[];
  return {
    inbox: {
      threads,
    },
  };
};

export const fetchThread = async (
  userDataPath: string,
  partition: string,
  threadId: string,
): Promise<InstagramThreadResponse> => {
  const state = await requireAuthedState(userDataPath, partition);
  const feed = state.ig.feed.directThread({ thread_id: threadId });

  let threadInfo: Record<string, unknown> = {};
  try {
    const response = await feed.request();
    threadInfo = response.thread ?? {};
  } catch {
    // If request() is unavailable/blocked, continue with items only.
  }

  const items = await feed.items();
  if (!Array.isArray((threadInfo as { users?: unknown[] }).users) || (threadInfo as { users?: unknown[] }).users?.length === 0) {
    try {
      const inboxThreads = (await state.ig.feed.directInbox().items()) as InstagramThread[];
      const fallbackThread = inboxThreads.find(
        (entry) => String(entry.thread_id ?? entry.thread_v2_id ?? '') === threadId,
      );
      if (fallbackThread) {
        threadInfo = {
          ...fallbackThread,
          ...threadInfo,
          users:
            Array.isArray((threadInfo as { users?: unknown[] }).users) &&
            (threadInfo as { users?: unknown[] }).users!.length > 0
              ? (threadInfo as { users?: unknown[] }).users
              : fallbackThread.users,
          thread_title:
            String((threadInfo as { thread_title?: string }).thread_title ?? '').trim() ||
            fallbackThread.thread_title,
        };
      }
    } catch {
      // Best-effort metadata backfill only.
    }
  }
  return {
    thread: {
      ...threadInfo,
      thread_id: String((threadInfo as { thread_id?: string }).thread_id ?? threadId),
      items,
    } as InstagramThread,
  };
};

export const fetchCurrentUser = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramCurrentUserResponse> => {
  const state = await requireAuthedState(userDataPath, partition);
  if (state.currentUser) {
    return { user: state.currentUser };
  }
  const user = (await resolveCurrentUser(state.ig)) as InstagramCurrentUserResponse['user'];
  state.currentUser = user;
  return { user };
};

export const sendThreadMessage = async (
  userDataPath: string,
  partition: string,
  threadId: string,
  text: string,
  replyToMessageId?: string,
): Promise<InstagramBroadcastResponse> => {
  const state = await requireAuthedState(userDataPath, partition);
  const thread = state.ig.entity.directThread(threadId);
  const replyTarget = await findReplyTarget(state.ig, threadId, replyToMessageId);
  return thread.broadcastText(text, replyTarget);
};

export const sendThreadImage = async (
  userDataPath: string,
  partition: string,
  threadId: string,
  dataUrl: string,
  caption?: string,
  replyToMessageId?: string,
): Promise<InstagramBroadcastResponse> => {
  const state = await requireAuthedState(userDataPath, partition);
  const thread = state.ig.entity.directThread(threadId);
  const result = await thread.broadcastPhoto({
    file: dataUrlToBuffer(dataUrl),
  });
  if (caption?.trim()) {
    const replyTarget = await findReplyTarget(state.ig, threadId, replyToMessageId);
    await thread.broadcastText(caption.trim(), replyTarget);
  }
  return result;
};

export const sendThreadVideo = async (
  userDataPath: string,
  partition: string,
  threadId: string,
  document: OutgoingAttachmentDocument,
  caption?: string,
  replyToMessageId?: string,
): Promise<InstagramBroadcastResponse> => {
  const state = await requireAuthedState(userDataPath, partition);
  const thread = state.ig.entity.directThread(threadId);
  const result = await thread.broadcastVideo({
    video: dataUrlToBuffer(document.dataUrl),
  });
  if (caption?.trim()) {
    const replyTarget = await findReplyTarget(state.ig, threadId, replyToMessageId);
    await thread.broadcastText(caption.trim(), replyTarget);
  }
  return result;
};

export const deleteThreadMessage = async (
  userDataPath: string,
  partition: string,
  threadId: string,
  messageId: string,
): Promise<boolean> => {
  const state = await requireAuthedState(userDataPath, partition);
  await state.ig.entity.directThread(threadId).deleteItem(messageId);
  return true;
};

export const markInstagramThreadRead = async (
  userDataPath: string,
  partition: string,
  threadId: string,
  itemId: string,
): Promise<void> => {
  const state = await requireAuthedState(userDataPath, partition);
  try {
    await state.realtime?.direct?.markAsSeen?.({ threadId, itemId });
  } catch {
    // Fall back to API below.
  }
  await state.ig.entity.directThread(threadId).markItemSeen(itemId);
};

export const getInstagramRealtimeStatus = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramRealtimeStatus> => {
  const partitionStatus = partitionRealtimeStatuses.get(partition);
  if (partitionStatus) {
    return partitionStatus;
  }
  const existing = activeClients.get(partition);
  if (existing) {
    return existing.realtimeStatus;
  }
  const state = await warmSessionClient(userDataPath, partition);
  return state?.realtimeStatus ?? 'disconnected';
};

export const subscribeInstagramRuntimeEvents = async (
  userDataPath: string,
  partition: string,
  listener: (event: InstagramRuntimeEvent) => void,
): Promise<() => void> => {
  const emitter = getPartitionEmitter(partition);
  const state = activeClients.get(partition) ?? (await warmSessionClient(userDataPath, partition));
  const wrapped = (event: InstagramRuntimeEvent) => listener(event);
  emitter.on('runtime', wrapped);
  listener({
    kind: 'realtime-status',
    status: state?.realtimeStatus ?? partitionRealtimeStatuses.get(partition) ?? 'disconnected',
  });
  return () => {
    emitter.off('runtime', wrapped);
  };
};

export const getBroadcastItemId = (result: InstagramBroadcastResponse): string | undefined =>
  extractItemId(result);
