import type { ChatMessage } from '../../../shared/connectors';
import { formatMessageDayLabel, hasValidTimestamp } from '../../lib/format';

interface TelegramMessageRenderSignatureInput {
  albumCaption: string;
  previousMessage: ChatMessage | null;
  primaryMessage: ChatMessage & { pendingState?: 'sending' };
  renderMessages: Array<ChatMessage & { pendingState?: 'sending' }>;
  shouldCollapseAlbum: boolean;
}

const serializeReactions = (message: ChatMessage): string =>
  (message.reactions ?? [])
    .map((reaction) => `${reaction.value}:${reaction.count}:${reaction.chosen ? '1' : '0'}`)
    .join('|');

const serializeMessage = (message: ChatMessage & { pendingState?: 'sending' }): string =>
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
    message.videoUrl ?? '',
    message.videoMimeType ?? '',
    message.animationUrl ?? '',
    message.animationMimeType ?? '',
    message.stickerUrl ?? '',
    message.stickerEmoji ?? '',
    message.stickerIsAnimated ? '1' : '0',
    serializeReactions(message),
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
    message.pendingState ?? '',
  ].join('::');

const serializePreviousMessageContext = (message: ChatMessage | null): string => {
  if (!message) {
    return 'root';
  }

  return [
    message.sender,
    message.outgoing ? '1' : '0',
    hasValidTimestamp(message.timestamp) ? formatMessageDayLabel(message.timestamp) : '',
  ].join('::');
};

export const getTelegramMessageRenderSignature = ({
  albumCaption,
  previousMessage,
  primaryMessage,
  renderMessages,
  shouldCollapseAlbum,
}: TelegramMessageRenderSignatureInput): string =>
  [
    shouldCollapseAlbum ? 'album' : 'single',
    albumCaption,
    serializeMessage(primaryMessage),
    serializePreviousMessageContext(previousMessage),
    renderMessages.map((message) => serializeMessage(message)).join('||'),
  ].join('###');
