import { verifyInstagramCapability as verifyBySession } from './client';

export const verifyInstagramCapability = async (
  userDataPath: string,
  partition: string,
): Promise<{
  ok: boolean;
  details: string;
  username?: string;
  requiresTwoFactor?: boolean;
  requiresChallenge?: boolean;
}> => {
  const result = await verifyBySession(userDataPath, partition);
  return {
    ok: result.ok,
    details: result.details,
    username: result.username,
    requiresTwoFactor: result.requiresTwoFactor,
    requiresChallenge: result.requiresChallenge,
  };
};
