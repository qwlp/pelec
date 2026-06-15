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

  it('changes when poll results change', () => {
    const base = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: null,
      primaryMessage: {
        ...message,
        poll: {
          question: 'Best editor?',
          kind: 'regular',
          options: [
            { text: 'Vim', voterCount: 2, votePercentage: 40 },
            { text: 'Helix', voterCount: 3, votePercentage: 60 },
          ],
          totalVoterCount: 5,
        },
      },
      renderMessages: [
        {
          ...message,
          poll: {
            question: 'Best editor?',
            kind: 'regular',
            options: [
              { text: 'Vim', voterCount: 2, votePercentage: 40 },
              { text: 'Helix', voterCount: 3, votePercentage: 60 },
            ],
            totalVoterCount: 5,
          },
        },
      ],
      shouldCollapseAlbum: false,
    });

    const next = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: null,
      primaryMessage: {
        ...message,
        poll: {
          question: 'Best editor?',
          kind: 'regular',
          options: [
            { text: 'Vim', voterCount: 4, votePercentage: 50 },
            { text: 'Helix', voterCount: 4, votePercentage: 50 },
          ],
          totalVoterCount: 8,
        },
      },
      renderMessages: [
        {
          ...message,
          poll: {
            question: 'Best editor?',
            kind: 'regular',
            options: [
              { text: 'Vim', voterCount: 4, votePercentage: 50 },
              { text: 'Helix', voterCount: 4, votePercentage: 50 },
            ],
            totalVoterCount: 8,
          },
        },
      ],
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

  it('does not change when the previous message only changes hidden metadata', () => {
    const previousMessage: ChatMessage = {
      id: '0',
      outgoing: true,
      sender: 'Ada',
      text: 'Earlier',
      timestamp: 99,
    };

    const base = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage,
      primaryMessage: message,
      renderMessages: [message],
      shouldCollapseAlbum: false,
    });

    const next = getTelegramMessageRenderSignature({
      albumCaption: '',
      previousMessage: {
        ...previousMessage,
        text: 'Edited earlier',
        readByPeer: true,
        reactions: [{ value: '👍', count: 1 }],
      },
      primaryMessage: message,
      renderMessages: [message],
      shouldCollapseAlbum: false,
    });

    expect(next).toBe(base);
  });

  it('keeps signature work bounded for unusually large message content', () => {
    const largeText = 'x'.repeat(100_000_000);
    const startedAt = performance.now();
    const signature = getTelegramMessageRenderSignature({
      albumCaption: largeText,
      previousMessage: null,
      primaryMessage: { ...message, text: largeText },
      renderMessages: [{ ...message, text: largeText }],
      shouldCollapseAlbum: false,
    });

    expect(signature.length).toBeLessThan(100);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
