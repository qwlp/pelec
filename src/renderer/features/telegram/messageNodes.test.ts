import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import {
  createTelegramDocumentCard,
  createTelegramMessageFooter,
  createTelegramMessageReactions,
} from './messageNodes';

describe('telegram message node helpers', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('renders document actions and wires copy/save handlers', () => {
    const copyTelegramDocument = vi.fn(async () => undefined);
    const downloadTelegramDocument = vi.fn(async () => undefined);
    const card = createTelegramDocumentCard({
      chatId: 'chat-1',
      copyTelegramDocument,
      downloadTelegramDocument,
      formatTelegramDocumentKind: () => 'PDF',
      formatTelegramDocumentSubtitle: () => '42 KB',
      message: {
        id: '1',
        document: { fileName: 'report.pdf', mimeType: 'application/pdf' },
        sender: 'Ada',
        text: '',
        timestamp: 1,
      },
      safeLabel: (value, fallback) => value ?? fallback,
    });

    const buttons = card.querySelectorAll('button');
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();

    expect(card.querySelector('.telegram-message-document-title')?.textContent).toBe('report.pdf');
    expect(copyTelegramDocument).toHaveBeenCalledTimes(1);
    expect(downloadTelegramDocument).toHaveBeenCalledTimes(1);
  });

  it('renders reactions and outgoing read state', () => {
    const reactions = createTelegramMessageReactions(
      {
        id: '1',
        outgoing: true,
        readByPeer: true,
        reactions: [{ value: '🔥', count: 2, chosen: true }],
        sender: 'Ada',
        text: 'hello',
        timestamp: 10,
      },
      (value, fallback) => value ?? fallback,
    );
    const footer = createTelegramMessageFooter({
      formatFullDateTime: () => 'Yesterday',
      formatMessageTimestamp: () => '10:00',
      hasValidTimestamp: () => true,
      isPendingTelegramMessage: () => false,
      message: {
        id: '1',
        outgoing: true,
        readByPeer: true,
        sender: 'Ada',
        text: 'hello',
        timestamp: 10,
      },
    });

    expect(reactions?.querySelector('.telegram-message-reaction-count')?.textContent).toBe('2');
    expect(footer.querySelector('.telegram-message-receipt.read')).not.toBeNull();
  });
});
