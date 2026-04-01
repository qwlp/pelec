const INSTAGRAM_CHECKPOINT_COOLDOWN_MS = 48 * 60 * 60 * 1000;
const INSTAGRAM_CHECKPOINT_COOLDOWN_KEY = 'pelec.instagramCheckpointCooldownUntil';

export const readInstagramCooldownUntil = (): number => {
  const raw = window.localStorage.getItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY);
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    window.localStorage.removeItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY);
    return 0;
  }
  return parsed;
};

export const writeInstagramCooldownUntil = (value: number): void => {
  window.localStorage.setItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY, String(value));
};

export const clearInstagramCooldownUntil = (): void => {
  window.localStorage.removeItem(INSTAGRAM_CHECKPOINT_COOLDOWN_KEY);
};

export const checkpointInDetails = (value?: string): boolean =>
  (value ?? '').toLowerCase().includes('checkpoint');

export const formatCooldownRemaining = (untilMs: number): string => {
  const remainingMs = Math.max(0, untilMs - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

export const getInstagramCheckpointCooldownUntil = (): number =>
  Date.now() + INSTAGRAM_CHECKPOINT_COOLDOWN_MS;
