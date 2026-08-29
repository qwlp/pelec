import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramPickerItem } from '../../../shared/connectors';
import { installDom } from '../../test/dom';
import { TelegramMediaPicker } from './TelegramMediaPicker';

const installPelecMock = (overrides: Partial<Window['pelec']> = {}) => {
  const api = {
    listTelegramStickerSets: vi.fn(async () => []),
    listTelegramPickerItems: vi.fn(async () => []),
    sendTelegramPickerItem: vi.fn(async () => true),
    ...overrides,
  } as unknown as Window['pelec'];
  Object.defineProperty(window, 'pelec', {
    configurable: true,
    value: api,
  });
  return api;
};

describe('TelegramMediaPicker', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('inserts emoji and keeps the picker open', () => {
    installPelecMock();
    const onEmojiInsert = vi.fn();
    const onClose = vi.fn();

    const { container } = render(
      <TelegramMediaPicker chatId="100" onClose={onClose} onEmojiInsert={onEmojiInsert} />,
    );

    fireEvent.click(container.querySelector('.telegram-media-picker-emoji') as Element);

    expect(onEmojiInsert).toHaveBeenCalledWith(expect.any(String));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends a sticker through the preload API and closes on success', async () => {
    const sticker: TelegramPickerItem = {
      id: '11',
      kind: 'sticker',
      previewUrl: 'pelec-media://local/?path=%2Ftmp%2Fsticker.webp',
      emoji: '😀',
    };
    const api = installPelecMock({
      listTelegramPickerItems: vi.fn(async () => [sticker]),
      sendTelegramPickerItem: vi.fn(async () => true),
    });
    const onClose = vi.fn();
    const onSent = vi.fn();

    const { container } = render(
      <TelegramMediaPicker
        chatId="100"
        onClose={onClose}
        onEmojiInsert={vi.fn()}
        onSent={onSent}
        replyToMessageId="55"
      />,
    );

    fireEvent.click(container.querySelectorAll('.telegram-media-picker-tab')[1] as Element);
    await waitFor(() => {
      expect(container.querySelector('.telegram-media-picker-media')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('.telegram-media-picker-media') as Element);

    await waitFor(() => {
      expect(api.sendTelegramPickerItem).toHaveBeenCalledWith('telegram', '100', sticker, '55');
      expect(onSent).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows recent stickers without loading sticker categories', async () => {
    const sticker: TelegramPickerItem = {
      id: '11',
      kind: 'sticker',
      previewUrl: 'pelec-media://local/?path=%2Ftmp%2Fsticker.webp',
    };
    const api = installPelecMock({
      listTelegramPickerItems: vi.fn(async () => [sticker]),
    });

    const { container } = render(
      <TelegramMediaPicker chatId="100" onClose={vi.fn()} onEmojiInsert={vi.fn()} />,
    );

    fireEvent.click(container.querySelectorAll('.telegram-media-picker-tab')[1] as Element);
    await waitFor(() => {
      expect(container.querySelector('.telegram-media-picker-media')).toBeTruthy();
    });

    expect(api.listTelegramPickerItems).toHaveBeenCalledWith('telegram', {
      kind: 'sticker',
      limit: 48,
    });
    expect(api.listTelegramStickerSets).not.toHaveBeenCalled();
    expect(container.querySelector('.telegram-media-picker-sets')).toBeNull();
  });

  it('renders loading, empty, and error states for Telegram media', async () => {
    let resolveItems: ((items: TelegramPickerItem[]) => void) | undefined;
    installPelecMock({
      listTelegramPickerItems: vi.fn(
        () =>
          new Promise<TelegramPickerItem[]>((resolve) => {
            resolveItems = resolve;
          }),
      ),
    });
    const { container, unmount } = render(
      <TelegramMediaPicker chatId="100" onClose={vi.fn()} onEmojiInsert={vi.fn()} />,
    );

    fireEvent.click(container.querySelectorAll('.telegram-media-picker-tab')[2] as Element);
    expect(container.querySelector('.telegram-media-picker-skeleton')).toBeTruthy();
    resolveItems?.([]);
    await waitFor(() => {
      expect(container.textContent).toContain('No saved Telegram GIFs.');
    });
    unmount();

    installPelecMock({
      listTelegramPickerItems: vi.fn(async () => {
        throw new Error('TDLib failed');
      }),
    });
    const errored = render(
      <TelegramMediaPicker chatId="100" onClose={vi.fn()} onEmojiInsert={vi.fn()} />,
    );
    fireEvent.click(errored.container.querySelectorAll('.telegram-media-picker-tab')[2] as Element);
    await waitFor(() => {
      expect(errored.container.textContent).toContain('TDLib failed');
    });
  });

  it('uses preview MIME type when choosing image versus video previews', async () => {
    installPelecMock({
      listTelegramPickerItems: vi.fn(async (): Promise<TelegramPickerItem[]> => [
        {
          id: '21',
          kind: 'gif',
          previewUrl: 'pelec-media://local/?path=%2Ftmp%2Fgif-thumb.jpg',
          previewMimeType: 'image/jpeg',
        },
        {
          id: '22',
          kind: 'gif',
          previewUrl: 'pelec-media://local/?path=%2Ftmp%2Fgif-preview.mp4',
          previewMimeType: 'video/mp4',
        },
      ]),
    });

    const { container } = render(
      <TelegramMediaPicker chatId="100" onClose={vi.fn()} onEmojiInsert={vi.fn()} />,
    );

    fireEvent.click(container.querySelectorAll('.telegram-media-picker-tab')[2] as Element);
    await waitFor(() => {
      expect(container.querySelectorAll('.telegram-media-picker-media')).toHaveLength(2);
    });

    const previews = container.querySelectorAll('.telegram-media-picker-media');
    expect(previews[0].querySelector('img')?.getAttribute('src')).toContain('gif-thumb.jpg');
    expect(previews[0].querySelector('video')).toBeNull();
    expect(previews[1].querySelector('video')?.getAttribute('src')).toContain('gif-preview.mp4');
  });

  it('moves grid focus with arrow keys and activates with Enter', () => {
    installPelecMock();
    const onEmojiInsert = vi.fn();
    const { container } = render(
      <TelegramMediaPicker chatId="100" onClose={vi.fn()} onEmojiInsert={onEmojiInsert} />,
    );
    const grid = container.querySelector('.telegram-media-picker-grid') as Element;

    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'Enter' });

    expect(onEmojiInsert).toHaveBeenCalledWith(expect.any(String));
  });
});
