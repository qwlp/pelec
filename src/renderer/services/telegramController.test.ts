import { describe, expect, it, vi } from 'vitest';
import { TelegramController } from './telegramController';

describe('TelegramController', () => {
  it('dedupes chat refresh requests while one is running', async () => {
    const controller = new TelegramController();
    const run = vi.fn(async () => undefined);

    await Promise.all([controller.refreshChats(run), controller.refreshChats(run)]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('dedupes message refresh requests per chat but not across chats', async () => {
    const controller = new TelegramController();
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);

    await Promise.all([
      controller.refreshMessages('chat-a', first),
      controller.refreshMessages('chat-a', first),
      controller.refreshMessages('chat-b', second),
    ]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tracks the latest request sequence', () => {
    const controller = new TelegramController();
    const first = controller.beginMessagesRequest();
    const second = controller.beginMessagesRequest();

    expect(controller.isCurrentMessagesRequest(first)).toBe(false);
    expect(controller.isCurrentMessagesRequest(second)).toBe(true);
  });
});
