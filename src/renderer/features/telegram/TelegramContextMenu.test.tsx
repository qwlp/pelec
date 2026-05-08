import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { TelegramContextMenu } from './TelegramContextMenu';

describe('TelegramContextMenu', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('routes menu actions through the provided handlers', () => {
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    const onForward = vi.fn();
    const onReply = vi.fn();
    const onSelect = vi.fn();

    const view = render(
      <TelegramContextMenu
        messageId="message-1"
        onClose={onClose}
        onCopy={onCopy}
        onDelete={onDelete}
        onForward={onForward}
        onReply={onReply}
        onSelect={onSelect}
        x={32}
        y={48}
      />,
    );

    fireEvent.click(view.getByText('Copy'));
    fireEvent.click(view.getByText('Forward'));
    fireEvent.click(view.getByText('Reply'));
    fireEvent.click(view.getByText('Select'));
    fireEvent.click(view.getByText('Delete'));

    expect(onCopy).toHaveBeenCalledWith('message-1');
    expect(onForward).toHaveBeenCalledWith('message-1');
    expect(onReply).toHaveBeenCalledWith('message-1');
    expect(onSelect).toHaveBeenCalledWith('message-1');
    expect(onDelete).toHaveBeenCalledWith('message-1');
    expect(onClose).toHaveBeenCalledTimes(5);
  });
});
