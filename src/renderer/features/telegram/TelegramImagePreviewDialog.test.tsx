import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { TelegramImagePreviewDialog } from './TelegramImagePreviewDialog';

describe('TelegramImagePreviewDialog', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('routes copy, download, and close actions', () => {
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onDownload = vi.fn();

    const view = render(
      <TelegramImagePreviewDialog
        imageUrl="data:image/png;base64,abc"
        onClose={onClose}
        onCopy={onCopy}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(view.getByRole('button', { name: 'Copy' }));
    fireEvent.click(view.getByRole('button', { name: 'Download' }));
    fireEvent.click(view.getByRole('button', { name: 'Close' }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rotates the preview with buttons and the r key', () => {
    const view = render(
      <TelegramImagePreviewDialog
        imageUrl="data:image/png;base64,abc"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    const image = view.getByAltText('Telegram image preview');

    fireEvent.click(view.getByRole('button', { name: 'Rotate right' }));
    expect(image.getAttribute('style')).toBe(
      'transform: translate(0px, 0px) rotate(90deg) scale(1);',
    );

    fireEvent.click(view.getByRole('button', { name: 'Rotate left' }));
    expect(image.getAttribute('style')).toBe('');

    fireEvent.keyDown(window, { key: 'r' });
    expect(image.getAttribute('style')).toBe(
      'transform: translate(0px, 0px) rotate(90deg) scale(1);',
    );
  });
});
