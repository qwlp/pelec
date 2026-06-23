import type { ChatMessage } from '../../../shared/connectors';
import { formatMessageDayLabel, hasValidTimestamp } from '../../lib/format';

interface TelegramMessageRenderSignatureInput {
  albumCaption: string;
  previousMessage: ChatMessage | null;
  primaryMessage: ChatMessage & { pendingState?: 'sending' };
  renderMessages: Array<ChatMessage & { pendingState?: 'sending' }>;
  shouldCollapseAlbum: boolean;
}

const SIGNATURE_SAMPLE_SIZE = 2048;

const createSignatureHasher = () => {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  let valueCount = 0;

  const add = (value: unknown): void => {
    const text = value === null || value === undefined ? '' : String(value);
    valueCount += 1;
    const sample =
      text.length > SIGNATURE_SAMPLE_SIZE * 2
        ? `${text.slice(0, SIGNATURE_SAMPLE_SIZE)}${text.slice(-SIGNATURE_SAMPLE_SIZE)}`
        : text;
    for (let index = 0; index < sample.length; index += 1) {
      const code = sample.charCodeAt(index);
      hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
      hashB = Math.imul(hashB ^ code, 0x85ebca6b) >>> 0;
    }
    hashA = Math.imul(hashA ^ 0xff, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ text.length, 0xc2b2ae35) >>> 0;
  };

  return {
    add,
    digest: (): string =>
      `${hashA.toString(36)}-${hashB.toString(36)}-${valueCount.toString(36)}`,
  };
};

const addMessageToSignature = (
  add: (value: unknown) => void,
  message: ChatMessage & { pendingState?: 'sending' },
): void => {
  [
    message.id,
    message.mediaAlbumId ?? '',
    message.sender,
    message.text,
    message.timestamp,
    message.outgoing ? '1' : '0',
    message.readByPeer ? '1' : '0',
    message.forwardedFrom ?? '',
    message.replyToMessageId ?? '',
    message.replyToSender ?? '',
    message.replyToText ?? '',
    message.imageUrl ?? '',
    message.imageSizeBytes ?? '',
    message.imageDeferred ? '1' : '0',
    message.videoUrl ?? '',
    message.videoThumbnailUrl ?? '',
    message.videoWidth ?? '',
    message.videoHeight ?? '',
    message.videoMimeType ?? '',
    message.animationUrl ?? '',
    message.animationMimeType ?? '',
    message.stickerUrl ?? '',
    message.stickerEmoji ?? '',
    message.stickerIsAnimated ? '1' : '0',
    message.hasAudio ? '1' : '0',
    message.hasVideo ? '1' : '0',
    message.audioUrl ?? '',
    message.audioDurationSeconds ?? '',
    message.senderAvatarUrl ?? '',
    message.document?.fileName ?? '',
    message.document?.mimeType ?? '',
    message.document?.sizeBytes ?? '',
    message.call?.isVideo ? '1' : '0',
    message.call?.durationSeconds ?? '',
    message.call?.discardReason ?? '',
    message.serviceEvent?.source ?? '',
    message.serviceEvent?.kind ?? '',
    message.serviceEvent?.title ?? '',
    message.serviceEvent?.detail ?? '',
    message.pendingState ?? '',
  ].forEach(add);

  for (const reaction of message.reactions ?? []) {
    add(reaction.value);
    add(reaction.count);
    add(reaction.chosen ? '1' : '0');
  }

  if (message.poll) {
    add(message.poll.question);
    add(message.poll.kind);
    add(message.poll.totalVoterCount ?? '');
    add(message.poll.isAnonymous ? '1' : '0');
    add(message.poll.isClosed ? '1' : '0');
    add(message.poll.allowsMultipleAnswers ? '1' : '0');
    add(message.poll.correctOptionIndex ?? '');
    for (const option of message.poll.options) {
      add(option.text);
      add(option.voterCount);
      add(option.votePercentage ?? '');
      add(option.chosen ? '1' : '0');
    }
  }
};

export const getTelegramMessageRenderSignature = ({
  albumCaption,
  previousMessage,
  primaryMessage,
  renderMessages,
  shouldCollapseAlbum,
}: TelegramMessageRenderSignatureInput): string => {
  const hasher = createSignatureHasher();
  hasher.add(shouldCollapseAlbum ? 'album' : 'single');
  hasher.add(albumCaption);
  addMessageToSignature(hasher.add, primaryMessage);
  if (previousMessage) {
    hasher.add(previousMessage.sender);
    hasher.add(previousMessage.outgoing ? '1' : '0');
    hasher.add(
      hasValidTimestamp(previousMessage.timestamp)
        ? formatMessageDayLabel(previousMessage.timestamp)
        : '',
    );
  } else {
    hasher.add('root');
  }
  for (const message of renderMessages) {
    addMessageToSignature(hasher.add, message);
  }
  return hasher.digest();
};
