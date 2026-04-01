export const safeText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const safeLabel = (value: unknown, fallback: string): string => {
  const text = safeText(value).trim();
  return text || fallback;
};

export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export const formatFileSize = (bytes?: number): string | undefined => {
  if (!bytes || bytes < 1) {
    return undefined;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

export const hasValidTimestamp = (timestamp?: number): timestamp is number =>
  typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;

const isSameCalendarDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatShortTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

export const formatFullDateTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export const formatChatTimestamp = (timestamp?: number): string => {
  if (!hasValidTimestamp(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameCalendarDay(date, now)) {
    return formatShortTime(timestamp);
  }
  if (isSameCalendarDay(date, yesterday)) {
    return 'Yesterday';
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }
  return date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatTelegramUnreadBadge = (count: number): string => {
  const normalized = Math.max(0, Math.floor(count));
  if (normalized > 99) {
    return '99+';
  }
  return String(normalized);
};

export const formatMessageTimestamp = (timestamp: number): string => {
  if (!hasValidTimestamp(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  if (isSameCalendarDay(date, now)) {
    return formatShortTime(timestamp);
  }

  return `${date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })}, ${formatShortTime(timestamp)}`;
};

export const formatMessageDayLabel = (timestamp: number): string => {
  if (!hasValidTimestamp(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameCalendarDay(date, now)) {
    return 'Today';
  }
  if (isSameCalendarDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
};
