import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../shared/connectors';
import { getTelegramMessageRenderSignature } from './messageRender';

describe('telegram message render signature', () => {
  const message: ChatMessage = {
    id: '1',
    sender: 'Ada',
    text: 'Hello',
    timestamp: 100,
  };

  it('changes when visible message content changes', () => {
    const base = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: null,
      primaryMessage: message,
      renderMessages: [message],
      shouldCollapseAlbum: false,
    });

    const next = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: null,
      primaryMessage: { ...message, text: 'Hello again' },
      renderMessages: [{ ...message, text: 'Hello again' }],
      shouldCollapseAlbum: false,
    });

    expect(next).not.toBe(base);
  });

  it('changes when previous-message context changes continuation or divider state', () => {
    const base = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: null,
      primaryMessage: message,
      renderMessages: [message],
      shouldCollapseAlbum: false,
    });

    const next = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: {
        id: '0',
        outgoing: true,
        sender: 'Ada',
        text: 'Earlier',
        timestamp: 99,
      },
      primaryMessage: message,
      renderMessages: [message],
      shouldCollapseAlbum: false,
    });

    expect(next).not.toBe(base);
  });
});
