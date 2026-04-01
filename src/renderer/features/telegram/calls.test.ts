import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramCallCard, describeTelegramCall } from './calls';
import { installDom } from '../../test/dom';

describe('describeTelegramCall', () => {
  it('formats disconnected calls with duration metadata', () => {
    expect(
      describeTelegramCall(
        {
          discardReason: 'disconnected',
          durationSeconds: 125,
        },
        false,
      ),
    ).toEqual({
      badge: 'VOICE',
      title: 'Voice call',
      meta: 'Dropped, duration 2:05',
      preview: 'Voice call (2:05)',
      tone: 'missed',
    });
  });

  it('marks outgoing missed video calls as unanswered', () => {
    expect(
      describeTelegramCall(
        {
          discardReason: 'missed',
          isVideo: true,
        },
        true,
      ),
    ).toMatchObject({
      badge: 'VIDEO',
      title: 'Unanswered video call',
      preview: 'Unanswered video call',
      tone: 'missed',
    });
  });
});

describe('createTelegramCallCard', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders the expected call card classes and content', () => {
    const card = createTelegramCallCard({
      id: '1',
      sender: 'Alice',
      text: '',
      timestamp: 0,
      call: {
        discardReason: 'declined',
        isVideo: true,
      },
    });

    expect(card.classList.contains('telegram-call-card')).toBe(true);
    expect(card.classList.contains('is-missed')).toBe(true);
    expect(card.classList.contains('is-video')).toBe(true);
    expect(card.querySelector('.telegram-call-badge')?.textContent).toBe('VIDEO');
    expect(card.querySelector('.telegram-call-title')?.textContent).toBe('Video call');
    expect(card.querySelector('.telegram-call-meta')?.textContent).toBe('You declined');
  });
});
