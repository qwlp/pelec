import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { session as electronSession } from 'electron';
import type {
  InstagramAuthResult,
  InstagramBroadcastResponse,
  InstagramCurrentUserResponse,
  InstagramInboxResponse,
  InstagramMetaState,
  InstagramThread,
  InstagramThreadResponse,
} from './types';

const authLog = (...args: unknown[]): void => {
  console.info('[instagram-auth][client]', ...args);
};

const nodeRequire = createRequire(__filename);

const activeClients = new Map<string, { ig: any; username: string }>();

const toPartitionKey = (partition: string): string =>
  partition.replace(/[^a-zA-Z0-9_-]/g, '_');

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

const isCheckpointError = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return lowered.includes('checkpoint_required') || lowered.includes('checkpoint required');
};

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof AggregateError) {
    const messages = Array.from(error.errors ?? [])
      .map((inner) => formatErrorMessage(inner))
      .filter((value) => !!value && value.toLowerCase() !== 'error');
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

const getCookieDomain = (domain: string): string => {
  const trimmed = domain.trim();
  if (!trimmed) {
    return '.instagram.com';
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
};

const setCookieOnJar = async (
  cookieJar: any,
  cookie: {
    name: string;
    value: string;
    domain: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
  },
): Promise<void> => {
  const attrs = [
    `${cookie.name}=${cookie.value}`,
    `Domain=${getCookieDomain(cookie.domain)}`,
    `Path=${cookie.path || '/'}`,
  ];
  if (cookie.secure) {
    attrs.push('Secure');
  }
  if (cookie.httpOnly) {
    attrs.push('HttpOnly');
  }

  const cookieString = attrs.join('; ');
  try {
    const result = cookieJar.setCookie(cookieString, 'https://i.instagram.com', {
      ignoreError: true,
    });
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch (error) {
    throw new Error(formatErrorMessage(error));
  }
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

const resolveCurrentUser = async (ig: any, timeoutMs = 8000): Promise<any> =>
  withTimeout(ig.account.currentUser(), timeoutMs, 'Timed out fetching Instagram current user.');

const getMetaState = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramMetaState> => {
  return (await readJsonFile<InstagramMetaState>(getMetaPath(userDataPath, partition))) ?? {};
};

const saveMetaState = async (
  userDataPath: string,
  partition: string,
  meta: InstagramMetaState,
): Promise<void> => {
  await writeJsonFile(getMetaPath(userDataPath, partition), meta);
};

const loadInstagramModule = async (): Promise<any> => {
  try {
    return nodeRequire('instagram-private-api');
  } catch {
    throw new Error(
      'Instagram native dependency missing: install "instagram-private-api" in the app project.',
    );
  }
};

const createIgClient = async (
  userDataPath: string,
  partition: string,
  username: string,
): Promise<any> => {
  const igModule = await loadInstagramModule();
  const ig = new igModule.IgApiClient();
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
  ig: any,
): Promise<void> => {
  const serialized = await ig.state.serialize();
  const { constants, ...stateToSave } = serialized as Record<string, unknown>;
  void constants;
  await writeJsonFile(getSessionPath(userDataPath, partition, username), stateToSave);
};

const warmSessionClient = async (
  userDataPath: string,
  partition: string,
): Promise<{ ig: any; username: string } | undefined> => {
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

  const currentUser = await resolveCurrentUser(ig);
  const resolvedUsername = String(currentUser?.username || username);
  const clientState = { ig, username: resolvedUsername };
  activeClients.set(partition, clientState);

  await saveMetaState(userDataPath, partition, {
    currentUsername: resolvedUsername,
    pendingTwoFactor: undefined,
  });

  return clientState;
};

const requireAuthedClient = async (userDataPath: string, partition: string): Promise<any> => {
  const hydrated = await warmSessionClient(userDataPath, partition);
  if (!hydrated) {
    throw new Error('Instagram session is not authenticated.');
  }
  return hydrated.ig;
};

export const resetInstagramAuthState = async (
  userDataPath: string,
  partition: string,
): Promise<void> => {
  activeClients.delete(partition);
  await rm(getStateRoot(userDataPath, partition), { recursive: true, force: true });
};

const safePreLoginFlow = async (ig: any): Promise<void> => {
  try {
    await ig.simulate.preLoginFlow();
  } catch {
    // Non-fatal; CLI implementation also treats flow errors as recoverable.
  }
};

const safePostLoginFlow = async (ig: any): Promise<void> => {
  try {
    await ig.simulate.postLoginFlow();
  } catch {
    // Non-fatal; successful auth can still proceed.
  }
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
              'Instagram checkpoint session expired. Complete the challenge in Instagram web/app, then retry auth.',
          };
        }
        const target = meta.pendingChallenge.contactPoint
          ? ` sent to ${meta.pendingChallenge.contactPoint}`
          : ' from Instagram via email, SMS, or the Instagram app/web checkpoint flow';
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
          'Instagram checkpoint required. Complete the security challenge in the Instagram web/app first, then retry auth.',
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

    const currentUser = await ig.account.currentUser();
    const resolvedUsername = String(currentUser?.username || normalizedUsername);

    await persistSessionState(userDataPath, partition, resolvedUsername, ig);
    await saveMetaState(userDataPath, partition, {
      currentUsername: resolvedUsername,
      pendingTwoFactor: undefined,
      pendingChallenge: undefined,
    });
    await clearPendingTwoFactorSession(userDataPath, partition);
    await clearPendingChallengeSession(userDataPath, partition);

    activeClients.set(partition, { ig, username: resolvedUsername });

    return {
      ok: true,
      username: resolvedUsername,
      details: `Instagram login successful for @${resolvedUsername}.`,
    };
  } catch (error: any) {
    const twoFactorInfo = error?.response?.body?.two_factor_info;
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
            'Instagram checkpoint requires web/app review. Native challenge state was not available, so complete the challenge in Instagram web/app and retry auth.',
        };
      }
      let challengeState: any;
      try {
        challengeState = await ig.challenge.auto(true);
      } catch {
        // Continue; the checkpoint session may still be recoverable for code submission.
      }
      const stepName = String(challengeState?.step_name || '').trim() || undefined;
      const contactPoint = String(challengeState?.step_data?.contact_point || '').trim() || undefined;
      if (stepName && !isChallengeCodeStep(stepName)) {
        return {
          ok: false,
          details:
            `Instagram checkpoint requires interactive review (${stepName}). Complete it in the Instagram web/app, then retry auth.`,
        };
      }
      const serialized = await ig.state.serialize();
      if (!hasCheckpointState(serialized as Record<string, unknown>)) {
        return {
          ok: false,
          details:
            'Instagram checkpoint could not be resumed natively. Complete the challenge in Instagram web/app, then retry auth.',
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
        : ' from Instagram via email, SMS, or the Instagram app/web checkpoint flow';
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

export const adoptInstagramWebSession = async (
  userDataPath: string,
  partition: string,
): Promise<InstagramAuthResult> => {
  try {
    authLog('adopt-web-session:start', { partition });
    const partitionSession = electronSession.fromPartition(partition);
    const [wwwCookies, rootCookies, iCookies] = await Promise.all([
      withTimeout(
        partitionSession.cookies.get({ url: 'https://www.instagram.com/' }),
        5000,
        'Timed out reading Instagram cookies (www).',
      ),
      withTimeout(
        partitionSession.cookies.get({ url: 'https://instagram.com/' }),
        5000,
        'Timed out reading Instagram cookies (root).',
      ),
      withTimeout(
        partitionSession.cookies.get({ url: 'https://i.instagram.com/' }),
        5000,
        'Timed out reading Instagram cookies (api).',
      ),
    ]);
    const allCookies = [...wwwCookies, ...rootCookies, ...iCookies];
    const cookies = allCookies
      .filter((cookie) => {
        const domain = (cookie.domain || '').toLowerCase();
        return domain.includes('instagram.com');
      })
      .filter((cookie, index, list) => {
      const key = `${cookie.name}|${cookie.domain}|${cookie.path}|${cookie.value}`;
      return list.findIndex((entry) => {
        const entryKey = `${entry.name}|${entry.domain}|${entry.path}|${entry.value}`;
        return entryKey === key;
      }) === index;
    });
    const sessionCookie = cookies.find((cookie) => cookie.name === 'sessionid');
    const userIdCookie = cookies.find((cookie) => cookie.name === 'ds_user_id');
    authLog('adopt-web-session:cookies', {
      totalInstagramCookies: cookies.length,
      hasSessionId: Boolean(sessionCookie?.value),
      hasDsUserId: Boolean(userIdCookie?.value),
    });

    if (!sessionCookie?.value || !userIdCookie?.value) {
      const cookieNames = cookies.map((cookie) => cookie.name).slice(0, 12).join(', ') || 'none';
      authLog('adopt-web-session:missing-session-cookies', { cookieNames });
      return {
        ok: false,
        details:
          `No Instagram browser session found in partition ${partition}. Missing session cookies (sessionid/ds_user_id). Found: ${cookieNames}`,
      };
    }

    const seed = `web-${userIdCookie.value}`;
    authLog('adopt-web-session:create-client:start', { seed });
    const ig = await withTimeout(
      createIgClient(userDataPath, partition, seed),
      6000,
      'Timed out creating Instagram API client.',
    );
    authLog('adopt-web-session:create-client:ok');

    let imported = 0;
    let skipped = 0;
    for (const cookie of cookies) {
      if (!cookie.name || !cookie.value) {
        skipped += 1;
        continue;
      }
      try {
        await withTimeout(
          setCookieOnJar(ig.state.cookieJar, {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || '.instagram.com',
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
          }),
          1500,
          `Timed out setting cookie ${cookie.name}.`,
        );
        imported += 1;
      } catch (error) {
        skipped += 1;
        authLog('adopt-web-session:cookie-set-failed', {
          name: cookie.name,
          domain: cookie.domain,
          message: formatErrorMessage(error),
        });
      }
    }
    authLog('adopt-web-session:cookie-import-summary', { imported, skipped });

    authLog('adopt-web-session:current-user:start');
    const currentUser = await resolveCurrentUser(ig);
    authLog('adopt-web-session:current-user:ok');
    const resolvedUsername = String(currentUser?.username || '').trim();
    if (!resolvedUsername) {
      authLog('adopt-web-session:username-empty');
      return {
        ok: false,
        details: 'Instagram browser session was detected but username could not be resolved.',
      };
    }

    authLog('adopt-web-session:persist:start', { resolvedUsername });
    await persistSessionState(userDataPath, partition, resolvedUsername, ig);
    await saveMetaState(userDataPath, partition, {
      currentUsername: resolvedUsername,
      pendingTwoFactor: undefined,
      pendingChallenge: undefined,
    });
    await clearPendingTwoFactorSession(userDataPath, partition);
    await clearPendingChallengeSession(userDataPath, partition);
    authLog('adopt-web-session:persist:ok');

    activeClients.set(partition, { ig, username: resolvedUsername });
    authLog('adopt-web-session:success', { username: resolvedUsername, partition });

    return {
      ok: true,
      username: resolvedUsername,
      details: `Instagram browser session linked for @${resolvedUsername}.`,
    };
  } catch (error) {
    const message = formatErrorMessage(error) || 'Failed to adopt Instagram browser session.';
    authLog('adopt-web-session:error', { message });
    if (isCheckpointError(message)) {
      return {
        ok: false,
        details:
          'Instagram checkpoint required. Complete the security challenge in the Instagram web/app first, then retry auth.',
      };
    }
    return {
      ok: false,
      details: `Instagram browser-session login failed: ${message}`,
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
    // Fall back if pending state is unavailable.
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

    const currentUser = await ig.account.currentUser();
    const resolvedUsername = String(currentUser?.username || pending.username);

    await persistSessionState(userDataPath, partition, resolvedUsername, ig);
    await saveMetaState(userDataPath, partition, {
      currentUsername: resolvedUsername,
      pendingTwoFactor: undefined,
      pendingChallenge: undefined,
    });
    await clearPendingTwoFactorSession(userDataPath, partition);
    await clearPendingChallengeSession(userDataPath, partition);

    activeClients.set(partition, { ig, username: resolvedUsername });

    return {
      ok: true,
      username: resolvedUsername,
      details: `Instagram 2FA complete for @${resolvedUsername}.`,
    };
  } catch (error) {
    const message = formatErrorMessage(error) || 'Instagram 2FA verification failed.';
    if (isCheckpointError(message)) {
      return {
        ok: false,
        username: pending.username,
        details:
          'Instagram checkpoint required after 2FA. Complete the challenge in Instagram web/app, then retry auth.',
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
        'Instagram checkpoint session expired. Complete the challenge in Instagram web/app, then retry auth.',
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
        'Instagram checkpoint session expired. Complete the challenge in Instagram web/app, then retry auth.',
    };
  }

  try {
    await ig.challenge.sendSecurityCode(code);
    await safePostLoginFlow(ig);

    const currentUser = await ig.account.currentUser();
    const resolvedUsername = String(currentUser?.username || pending.username);

    await persistSessionState(userDataPath, partition, resolvedUsername, ig);
    await saveMetaState(userDataPath, partition, {
      currentUsername: resolvedUsername,
      pendingTwoFactor: undefined,
      pendingChallenge: undefined,
    });
    await clearPendingTwoFactorSession(userDataPath, partition);
    await clearPendingChallengeSession(userDataPath, partition);

    activeClients.set(partition, { ig, username: resolvedUsername });

    return {
      ok: true,
      username: resolvedUsername,
      details: `Instagram challenge complete for @${resolvedUsername}.`,
    };
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
  const ig = await requireAuthedClient(userDataPath, partition);
  const feed = ig.feed.directInbox();
  const threads = (await feed.items()) as InstagramThread[];
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
  const ig = await requireAuthedClient(userDataPath, partition);
  const feed = ig.feed.directThread({ thread_id: threadId });

  let threadInfo: Record<string, unknown> = {};
  try {
    const response = (await feed.request()) as { thread?: Record<string, unknown> };
    threadInfo = response.thread ?? {};
  } catch {
    // If request() is unavailable/blocked, continue with items only.
  }

  const items = await feed.items();
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
  const ig = await requireAuthedClient(userDataPath, partition);
  const user = (await resolveCurrentUser(ig)) as InstagramCurrentUserResponse['user'];
  return { user };
};

export const sendThreadMessage = async (
  userDataPath: string,
  partition: string,
  threadId: string,
  text: string,
  replyToMessageId?: string,
): Promise<InstagramBroadcastResponse> => {
  const ig = await requireAuthedClient(userDataPath, partition);
  const thread = ig.entity.directThread(threadId);

  if (replyToMessageId) {
    try {
      await thread.broadcastText(text, {
        item_id: replyToMessageId,
        client_context: replyToMessageId,
      });
      return { status: 'ok' };
    } catch {
      // Fall through to plain send if API rejects reply payload shape.
    }
  }

  await thread.broadcastText(text);
  return { status: 'ok' };
};
