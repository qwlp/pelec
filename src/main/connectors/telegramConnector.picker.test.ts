import { describe, expect, it, vi } from 'vitest';
import type { NetworkDefinition, TelegramUserConfig } from '../../shared/types';
import type { TdClient } from './telegram/types';
import { TelegramConnector } from './telegramConnector';

const createConnector = (): TelegramConnector =>
  new TelegramConnector(
    {
      id: 'telegram',
      name: 'Telegram',
      homeUrl: 'https://web.telegram.org',
      loginHint: 'Login',
      partition: 'persist:telegram',
      supportLevel: 'native-web',
    } as NetworkDefinition,
    '/tmp/pelec-test',
    {
      ghostMode: false,
      selectableMessageText: false,
    } as TelegramUserConfig,
  );

describe('TelegramConnector picker methods', () => {
  it('returns safe defaults when unauthenticated', async () => {
    const connector = createConnector();

    await expect(connector.listTelegramStickerSets('recent')).resolves.toEqual([]);
    await expect(connector.listTelegramPickerItems({ kind: 'sticker' })).resolves.toEqual([]);
    await expect(
      connector.sendTelegramPickerItem('1', {
        id: '11',
        kind: 'sticker',
        previewUrl: 'preview',
      }),
    ).resolves.toBe(false);
  });

  it('edits text messages using TDLib editMessageText', async () => {
    const connector = createConnector() as unknown as {
      status: { authState: string };
      tdClient: TdClient;
      editMessage: TelegramConnector['editMessage'];
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        id: 55,
        is_outgoing: true,
        can_be_edited: true,
      })
      .mockResolvedValueOnce({});
    connector.status.authState = 'authenticated';
    connector.tdClient = {
      invoke,
      on: vi.fn(),
    };

    await expect(connector.editMessage('100', '55', 'updated text')).resolves.toBe(true);

    expect(invoke).toHaveBeenNthCalledWith(1, {
      _: 'getMessage',
      chat_id: 100,
      message_id: 55,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, {
      _: 'editMessageText',
      chat_id: 100,
      message_id: 55,
      input_message_content: {
        _: 'inputMessageText',
        text: {
          _: 'formattedText',
          text: 'updated text',
        },
      },
    });
  });

  it('refuses to edit incoming messages', async () => {
    const connector = createConnector() as unknown as {
      status: { authState: string };
      tdClient: TdClient;
      editMessage: TelegramConnector['editMessage'];
    };
    const invoke = vi.fn().mockResolvedValue({
      id: 55,
      is_outgoing: false,
      can_be_edited: false,
    });
    connector.status.authState = 'authenticated';
    connector.tdClient = {
      invoke,
      on: vi.fn(),
    };

    await expect(connector.editMessage('100', '55', 'updated text')).resolves.toBe(false);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith({
      _: 'getMessage',
      chat_id: 100,
      message_id: 55,
    });
  });

  it('edits messages sent as a channel identity when Telegram allows it', async () => {
    const connector = createConnector() as unknown as {
      status: { authState: string };
      tdClient: TdClient;
      editMessage: TelegramConnector['editMessage'];
    };
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        id: 55,
        is_outgoing: false,
        can_be_edited: true,
      })
      .mockResolvedValueOnce({});
    connector.status.authState = 'authenticated';
    connector.tdClient = {
      invoke,
      on: vi.fn(),
    };

    await expect(connector.editMessage('100', '55', 'updated text')).resolves.toBe(true);

    expect(invoke).toHaveBeenNthCalledWith(2, {
      _: 'editMessageText',
      chat_id: 100,
      message_id: 55,
      input_message_content: {
        _: 'inputMessageText',
        text: {
          _: 'formattedText',
          text: 'updated text',
        },
      },
    });
  });

  it('sends stickers and GIFs using TDLib inputFileId payloads', async () => {
    const connector = createConnector() as unknown as {
      status: { authState: string };
      tdClient: TdClient;
      sendTelegramPickerItem: TelegramConnector['sendTelegramPickerItem'];
    };
    const invoke = vi.fn(async () => ({}));
    connector.status.authState = 'authenticated';
    connector.tdClient = {
      invoke,
      on: vi.fn(),
    };

    await expect(
      connector.sendTelegramPickerItem('100', {
        id: '11',
        kind: 'sticker',
        previewUrl: 'preview',
        emoji: '😀',
        width: 512,
        height: 512,
      }),
    ).resolves.toBe(true);
    await expect(
      connector.sendTelegramPickerItem('100', {
        id: '21',
        kind: 'gif',
        previewUrl: 'preview',
        width: 320,
        height: 240,
      }),
    ).resolves.toBe(true);

    expect(invoke).toHaveBeenNthCalledWith(1, {
      _: 'sendMessage',
      chat_id: 100,
      input_message_content: {
        _: 'inputMessageSticker',
        sticker: {
          _: 'inputFileId',
          id: 11,
        },
        thumbnail: null,
        emoji: '😀',
        width: 512,
        height: 512,
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, {
      _: 'sendMessage',
      chat_id: 100,
      input_message_content: {
        _: 'inputMessageAnimation',
        animation: {
          _: 'inputFileId',
          id: 21,
        },
        thumbnail: null,
        added_sticker_file_ids: [],
        duration: 0,
        width: 320,
        height: 240,
        caption: {
          _: 'formattedText',
          text: '',
        },
      },
    });
  });
});
