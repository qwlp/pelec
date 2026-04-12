import type { ChatMessage, ChatSummary } from '../../../shared/connectors';
import type {
  InstagramCurrentUserResponse,
  InstagramMessageItem,
  InstagramThread,
} from './types';

const toTimestamp = (value: string | number | undefined): number => {
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? value / 1000 : value;
  }
  if (!value) {
    return Date.now();
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Date.now();
  }
  return parsed > 1_000_000_000_000 ? parsed / 1000 : parsed;
};

const extractMessageText = (item: InstagramMessageItem | undefined): string => {
  if (!item) {
    return '';
  }
  if (typeof item.text === 'string' && item.text.trim()) {
    return item.text.trim();
  }
  if (item.link?.text?.trim()) {
    return item.link.text.trim();
  }
  const itemType = item.item_type ?? '';
  if (itemType === 'media' || itemType === 'media_share') {
    const media = item.media ?? item.media_share;
    if (media?.video_versions?.length) {
      return '[video]';
    }
    return '[photo]';
  }
  if (itemType === 'action_log') {
    return item.action_log?.description?.trim() || '[activity]';
  }
  if (itemType) {
    return `[${itemType}]`;
  }
  return '';
};

const resolveMedia = (item: InstagramMessageItem | undefined) => item?.media ?? item?.media_share;

const mapReactions = (
  reactions: InstagramMessageItem['reactions'],
): ChatMessage['reactions'] | undefined => {
  if (!reactions) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const like of reactions.likes ?? []) {
    void like;
    counts.set('❤️', (counts.get('❤️') ?? 0) + 1);
  }
  for (const emoji of reactions.emojis ?? []) {
    counts.set(emoji.emoji, (counts.get(emoji.emoji) ?? 0) + 1);
  }

  if (counts.size < 1) {
    return undefined;
  }

  return Array.from(counts.entries()).map(([value, count]) => ({
    value,
    count,
  }));
};

export const mapThreadToChatSummary = (thread: InstagramThread): ChatSummary => {
  const fallbackTitle =
    thread.users
      ?.map((user) => user.full_name || user.username)
      .filter((value): value is string => !!value && value.trim().length > 0)
      .join(', ') || 'Instagram chat';
  const lastItem = thread.items?.[0] ?? thread.last_permanent_item;
  const unreadCount =
    typeof thread.unread_count === 'number'
      ? thread.unread_count
      : thread.read_state === 0
        ? 1
        : 0;

  return {
    id: thread.thread_id ?? thread.thread_v2_id ?? '',
    title: thread.thread_title || fallbackTitle,
    unreadCount: Number(unreadCount),
    lastMessagePreview: extractMessageText(lastItem),
    lastMessageSender:
      lastItem?.user_id !== undefined
        ? thread.users?.find((user) => String(user.pk) === String(lastItem.user_id))?.username
        : undefined,
    lastMessageTimestamp: toTimestamp(lastItem?.timestamp ?? thread.last_activity_at),
    avatarUrl: thread.users?.[0]?.profile_pic_url,
    canSend: true,
  };
};

export const mapItemToChatMessage = (
  item: InstagramMessageItem,
  senderLabelById: Map<string, string>,
  senderAvatarById: Map<string, string | undefined>,
  currentUserPk?: string,
): ChatMessage => {
  const senderId = String(item.user_id ?? '');
  const text = extractMessageText(item);
  const media = resolveMedia(item);
  const imageUrl = media?.image_versions2?.candidates?.[0]?.url;
  const videoUrl = media?.video_versions?.[0]?.url;
  const replySenderId = item.replied_to_message?.user_id;

  return {
    id: item.item_id ?? `${senderId}:${item.timestamp ?? Date.now()}`,
    sender: senderLabelById.get(senderId) ?? 'Unknown',
    senderAvatarUrl: senderAvatarById.get(senderId),
    text,
    imageUrl,
    videoUrl,
    videoMimeType: videoUrl ? 'video/mp4' : undefined,
    timestamp: toTimestamp(item.timestamp),
    outgoing: item.is_sent_by_viewer ?? (!!currentUserPk && senderId === currentUserPk),
    readByPeer: Array.isArray(item.seen_user_ids)
      ? item.seen_user_ids.some((id) => String(id) !== currentUserPk)
      : undefined,
    replyToMessageId: item.replied_to_message?.item_id,
    replyToSender:
      replySenderId !== undefined ? senderLabelById.get(String(replySenderId)) ?? 'Unknown' : undefined,
    replyToText: item.replied_to_message?.text?.trim() || undefined,
    reactions: mapReactions(item.reactions),
  };
};

export const buildParticipantMaps = (
  thread: InstagramThread | undefined,
  currentUser: InstagramCurrentUserResponse | undefined,
): {
  senderLabelById: Map<string, string>;
  senderAvatarById: Map<string, string | undefined>;
} => {
  const senderLabelById = new Map<string, string>();
  const senderAvatarById = new Map<string, string | undefined>();

  for (const user of thread?.users ?? []) {
    const label = user.full_name || user.username || 'Instagram user';
    if (user.pk !== undefined) {
      const idKey = String(user.pk);
      senderLabelById.set(idKey, label);
      senderAvatarById.set(idKey, user.profile_pic_url);
    }
  }

  const currentPk = currentUser?.user?.pk;
  if (currentPk !== undefined) {
    const idKey = String(currentPk);
    senderLabelById.set(idKey, currentUser.user?.username || 'You');
    senderAvatarById.set(idKey, currentUser.user?.profile_pic_url);
  }

  return { senderLabelById, senderAvatarById };
};
