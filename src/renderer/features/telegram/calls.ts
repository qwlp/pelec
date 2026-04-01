import type { ChatCall, ChatMessage } from '../../../shared/connectors';
import { formatDuration } from '../../lib/format';

type TelegramCallTone = 'connected' | 'missed';

export type TelegramCallDetails = {
  badge: string;
  title: string;
  meta: string;
  preview: string;
  tone: TelegramCallTone;
};

const formatCallDurationMeta = (seconds?: number): string | undefined => {
  if (!seconds || seconds < 1) {
    return undefined;
  }
  return `Duration ${formatDuration(seconds)}`;
};

export const describeTelegramCall = (
  call: ChatCall | undefined,
  outgoing: boolean | undefined,
): TelegramCallDetails => {
  const isVideo = call?.isVideo === true;
  const kind = isVideo ? 'video call' : 'voice call';
  const badge = isVideo ? 'VIDEO' : 'VOICE';
  const durationMeta = formatCallDurationMeta(call?.durationSeconds);

  if (call?.discardReason === 'missed') {
    return {
      badge,
      title: outgoing ? `Unanswered ${kind}` : `Missed ${kind}`,
      meta: 'No answer',
      preview: outgoing ? `Unanswered ${kind}` : `Missed ${kind}`,
      tone: 'missed',
    };
  }

  if (call?.discardReason === 'declined') {
    return {
      badge,
      title: isVideo ? 'Video call' : 'Voice call',
      meta: outgoing ? 'Declined' : 'You declined',
      preview: outgoing ? `Declined ${kind}` : `You declined ${kind}`,
      tone: 'missed',
    };
  }

  if (call?.discardReason === 'disconnected') {
    return {
      badge,
      title: isVideo ? 'Video call' : 'Voice call',
      meta: durationMeta ? `Dropped, ${durationMeta.toLowerCase()}` : 'Connection dropped',
      preview: durationMeta
        ? `${isVideo ? 'Video' : 'Voice'} call (${formatDuration(call.durationSeconds ?? 0)})`
        : `Dropped ${kind}`,
      tone: 'missed',
    };
  }

  return {
    badge,
    title: isVideo ? 'Video call' : 'Voice call',
    meta: durationMeta ?? (outgoing ? 'Outgoing' : 'Incoming'),
    preview: durationMeta
      ? `${isVideo ? 'Video' : 'Voice'} call (${formatDuration(call?.durationSeconds ?? 0)})`
      : `${isVideo ? 'Video' : 'Voice'} call`,
    tone: 'connected',
  };
};

export const createTelegramCallCard = (message: ChatMessage): HTMLElement => {
  const details = describeTelegramCall(message.call, message.outgoing);
  const card = document.createElement('section');
  card.className = 'telegram-call-card';
  card.classList.add(details.tone === 'missed' ? 'is-missed' : 'is-connected');
  if (message.call?.isVideo) {
    card.classList.add('is-video');
  }

  const badge = document.createElement('div');
  badge.className = 'telegram-call-badge';
  badge.textContent = details.badge;

  const content = document.createElement('div');
  content.className = 'telegram-call-content';
  const title = document.createElement('div');
  title.className = 'telegram-call-title';
  title.textContent = details.title;
  const meta = document.createElement('div');
  meta.className = 'telegram-call-meta';
  meta.textContent = details.meta;
  content.replaceChildren(title, meta);

  card.replaceChildren(badge, content);
  return card;
};
