import type { ChatCall, ChatReaction } from '../../../shared/connectors';

export const formatTelegramCallDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export const extractTelegramCallInfo = (content: unknown): ChatCall | undefined => {
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const container = content as {
    _?: string;
    is_video?: boolean;
    duration?: number;
    discard_reason?: { _?: string };
  };

  if (container._ !== 'messageCall') {
    return undefined;
  }

  let discardReason: ChatCall['discardReason'];
  switch (container.discard_reason?._) {
    case 'callDiscardReasonMissed':
      discardReason = 'missed';
      break;
    case 'callDiscardReasonDeclined':
      discardReason = 'declined';
      break;
    case 'callDiscardReasonDisconnected':
      discardReason = 'disconnected';
      break;
    case 'callDiscardReasonHungUp':
      discardReason = 'hung_up';
      break;
    case 'callDiscardReasonEmpty':
      discardReason = 'empty';
      break;
    default:
      discardReason = undefined;
      break;
  }

  return {
    isVideo: container.is_video === true,
    durationSeconds:
      typeof container.duration === 'number' && container.duration > 0
        ? Math.floor(container.duration)
        : undefined,
    discardReason,
  };
};

export const extractTelegramMessageText = (
  content: unknown,
  options?: {
    outgoing?: boolean;
  },
): string => {
  if (!content || typeof content !== 'object') {
    return '';
  }
  const container = content as {
    _: string;
    text?: { text?: string };
    caption?: { text?: string };
    emoji?: string;
    title?: string;
    performer?: string;
    file_name?: string;
    contact?: { first_name?: string; last_name?: string; phone_number?: string };
    location?: { latitude?: number; longitude?: number };
  };

  if (container.text?.text) {
    return container.text.text;
  }
  if (container.caption?.text) {
    return container.caption.text;
  }

  if (container._ === 'messageSticker') {
    return container.emoji ? `Sticker ${container.emoji}` : 'Sticker';
  }
  if (container._ === 'messageAnimatedEmoji') {
    return container.emoji ? `Animated emoji ${container.emoji}` : 'Animated emoji';
  }
  if (container._ === 'messageVoiceNote') {
    return 'Voice message';
  }
  if (container._ === 'messageVideoNote') {
    return 'Video message';
  }
  if (container._ === 'messagePhoto') {
    return 'Photo';
  }
  if (container._ === 'messageVideo') {
    return 'Video';
  }
  if (container._ === 'messageAnimation') {
    return 'GIF/Animation';
  }
  if (container._ === 'messageAudio') {
    const title = container.title?.trim();
    const performer = container.performer?.trim();
    if (title && performer) {
      return `Audio: ${performer} - ${title}`;
    }
    if (title) {
      return `Audio: ${title}`;
    }
    return 'Audio file';
  }
  if (container._ === 'messageDocument') {
    return container.file_name ? `Document: ${container.file_name}` : 'Document';
  }
  if (container._ === 'messageContact') {
    const firstName = container.contact?.first_name?.trim() ?? '';
    const lastName = container.contact?.last_name?.trim() ?? '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) {
      return `Contact: ${fullName}`;
    }
    return container.contact?.phone_number ? `Contact: ${container.contact.phone_number}` : 'Contact';
  }
  if (container._ === 'messageLocation') {
    const lat = container.location?.latitude;
    const lon = container.location?.longitude;
    if (typeof lat === 'number' && typeof lon === 'number') {
      return `Location: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    return 'Location';
  }
  if (container._ === 'messageCall') {
    const call = extractTelegramCallInfo(content);
    const kind = call?.isVideo ? 'video call' : 'voice call';
    if (call?.discardReason === 'missed') {
      return options?.outgoing ? `Unanswered ${kind}` : `Missed ${kind}`;
    }
    if (call?.discardReason === 'declined') {
      return options?.outgoing ? `Declined ${kind}` : `You declined ${kind}`;
    }
    if (call?.discardReason === 'disconnected') {
      return call.durationSeconds
        ? `${call.isVideo ? 'Video' : 'Voice'} call (${formatTelegramCallDuration(call.durationSeconds)})`
        : `Dropped ${kind}`;
    }
    if (call?.durationSeconds) {
      return `${call.isVideo ? 'Video' : 'Voice'} call (${formatTelegramCallDuration(call.durationSeconds)})`;
    }
    return `${call?.isVideo ? 'Video' : 'Voice'} call`;
  }
  if (container._ === 'messageChatAddMembers') {
    return 'Members added';
  }
  if (container._ === 'messageChatDeleteMember') {
    return 'Member removed';
  }
  if (container._ === 'messageChatJoinByLink') {
    return 'Joined via invite link';
  }
  if (container._ === 'messageChatJoinByRequest') {
    return 'Join request approved';
  }
  if (container._ === 'messageChatChangeTitle') {
    return 'Group title changed';
  }
  if (container._ === 'messagePinMessage') {
    return 'Pinned a message';
  }
  if (container._ === 'messagePoll') {
    return 'Poll';
  }

  return `[${container._ ?? 'message'}]`;
};

export const extractTelegramReactions = (
  interactionInfo: unknown,
): ChatReaction[] | undefined => {
  if (!interactionInfo || typeof interactionInfo !== 'object') {
    return undefined;
  }

  const container = interactionInfo as {
    reactions?: {
      reactions?: Array<{
        type?: {
          _?: string;
          emoji?: string;
        };
        total_count?: number;
        is_chosen?: boolean;
      }>;
    };
  };

  const reactions = (container.reactions?.reactions ?? [])
    .map<ChatReaction | undefined>((reaction) => {
      const type = reaction.type?._;
      const value =
        type === 'reactionTypeEmoji'
          ? reaction.type?.emoji?.trim()
          : type === 'reactionTypeCustomEmoji'
            ? 'Custom'
            : type === 'reactionTypePaid'
              ? 'Paid'
              : undefined;
      const count = Number(reaction.total_count ?? 0);
      if (!value || count < 1) {
        return undefined;
      }
      return {
        value,
        count,
        chosen: reaction.is_chosen === true || undefined,
      };
    })
    .filter((reaction): reaction is ChatReaction => reaction !== undefined);

  return reactions.length > 0 ? reactions : undefined;
};
