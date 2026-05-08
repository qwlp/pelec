import { describe, expect, it } from 'vitest';
import {
  buildTelegramChatPreview,
  extractTelegramCallInfo,
  extractTelegramMessageText,
  extractTelegramPollInfo,
  extractTelegramReactions,
  formatTelegramCallDuration,
} from './messages';

describe('telegram message helpers', () => {
  it('formats call durations with and without hours', () => {
    expect(formatTelegramCallDuration(65)).toBe('1:05');
    expect(formatTelegramCallDuration(3661)).toBe('1:01:01');
  });

  it('parses call payloads and call text previews', () => {
    const content = {
      _: 'messageCall',
      is_video: true,
      duration: 125,
      discard_reason: { _: 'callDiscardReasonDisconnected' },
    };

    expect(extractTelegramCallInfo(content)).toEqual({
      isVideo: true,
      durationSeconds: 125,
      discardReason: 'disconnected',
    });
    expect(extractTelegramMessageText(content)).toBe('Video call (2:05)');
  });

  it('builds fallback text for common message types', () => {
    expect(
      extractTelegramMessageText({
        _: 'messageAudio',
        title: 'Track',
        performer: 'Artist',
      }),
    ).toBe('Audio: Artist - Track');

    expect(
      extractTelegramMessageText({
        _: 'messageContact',
        contact: { first_name: 'Ada', last_name: 'Lovelace' },
      }),
    ).toBe('Contact: Ada Lovelace');

    expect(
      extractTelegramMessageText({
        _: 'messagePoll',
        poll: {
          question: 'Best editor?',
        },
      }),
    ).toBe('Poll: Best editor?');
  });

  it('extracts poll metadata from telegram poll messages', () => {
    expect(
      extractTelegramPollInfo({
        _: 'messagePoll',
        poll: {
          question: 'Best editor?',
          total_voter_count: 12,
          is_anonymous: false,
          is_closed: true,
          type: {
            _: 'pollTypeQuiz',
            correct_option_id: 1,
          },
          options: [
            {
              text: 'Vim',
              voter_count: 5,
              vote_percentage: 42,
            },
            {
              text: 'Helix',
              voter_count: 7,
              vote_percentage: 58,
              is_chosen: true,
            },
          ],
        },
      }),
    ).toEqual({
      question: 'Best editor?',
      options: [
        { text: 'Vim', voterCount: 5, votePercentage: 42, chosen: undefined },
        { text: 'Helix', voterCount: 7, votePercentage: 58, chosen: true },
      ],
      totalVoterCount: 12,
      isAnonymous: false,
      isClosed: true,
      allowsMultipleAnswers: undefined,
      kind: 'quiz',
      correctOptionIndex: 1,
    });
  });

  it('extracts poll text from nested formatted-text-like objects', () => {
    expect(
      extractTelegramPollInfo({
        _: 'messagePoll',
        poll: {
          question: { text: 'Best editor?' },
          options: [
            {
              text: { text: 'Vim' },
              voter_count: 5,
              vote_percentage: 42,
            },
            {
              text: { text: 'Helix' },
              voter_count: 7,
              vote_percentage: 58,
            },
          ],
        },
      }),
    ).toEqual({
      question: 'Best editor?',
      options: [
        { text: 'Vim', voterCount: 5, votePercentage: 42, chosen: undefined },
        { text: 'Helix', voterCount: 7, votePercentage: 58, chosen: undefined },
      ],
      totalVoterCount: undefined,
      isAnonymous: undefined,
      isClosed: undefined,
      allowsMultipleAnswers: undefined,
      kind: 'regular',
      correctOptionIndex: undefined,
    });

    expect(
      extractTelegramMessageText({
        _: 'messagePoll',
        poll: {
          question: { text: 'Best editor?' },
        },
      }),
    ).toBe('Poll: Best editor?');
  });

  it('tolerates malformed poll fields without throwing', () => {
    expect(
      extractTelegramPollInfo({
        _: 'messagePoll',
        poll: {
          question: 123,
          options: [
            {
              text: { value: 'bad' },
              voter_count: '7',
              vote_percentage: '58',
            },
          ],
        },
      }),
    ).toEqual({
      question: 'Poll',
      options: [
        { text: 'Option 1', voterCount: 7, votePercentage: 58, chosen: undefined },
      ],
      totalVoterCount: undefined,
      isAnonymous: undefined,
      isClosed: undefined,
      allowsMultipleAnswers: undefined,
      kind: 'regular',
      correctOptionIndex: undefined,
    });

    expect(
      extractTelegramMessageText({
        _: 'messagePoll',
        poll: {
          question: 123,
        },
      }),
    ).toBe('Poll');
  });

  it('extracts supported reactions and drops empty entries', () => {
    expect(
      extractTelegramReactions({
        reactions: {
          reactions: [
            {
              type: { _: 'reactionTypeEmoji', emoji: '🔥' },
              total_count: 3,
              is_chosen: true,
            },
            {
              type: { _: 'reactionTypePaid' },
              total_count: 1,
            },
            {
              type: { _: 'reactionTypeEmoji', emoji: ' ' },
              total_count: 0,
            },
          ],
        },
      }),
    ).toEqual([
      { value: '🔥', count: 3, chosen: true },
      { value: 'Paid', count: 1, chosen: undefined },
    ]);
  });

  it('adds sender context for group chat previews and trims usernames', () => {
    expect(
      buildTelegramChatPreview({
        chatTitle: 'Ops Room',
        includeSender: true,
        isOutgoing: false,
        previewText: 'Deploy done',
        senderLabel: 'Ada Lovelace (@ada)',
      }),
    ).toEqual({
      previewText: 'Deploy done',
      senderLabel: 'Ada Lovelace',
    });
  });

  it('uses You for outgoing group chat previews and suppresses duplicate chat-title senders', () => {
    expect(
      buildTelegramChatPreview({
        chatTitle: 'Ops Room',
        includeSender: true,
        isOutgoing: true,
        previewText: 'Deploy done',
        senderLabel: 'Ignored',
      }),
    ).toEqual({
      previewText: 'Deploy done',
      senderLabel: 'You',
    });

    expect(
      buildTelegramChatPreview({
        chatTitle: 'Ops Room',
        includeSender: true,
        isOutgoing: false,
        previewText: 'Announcement',
        senderLabel: 'Ops Room',
      }),
    ).toEqual({
      previewText: 'Announcement',
    });
  });
});
