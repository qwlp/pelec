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
    const onEdit = vi.fn();
    const onForward = vi.fn();
    const onReply = vi.fn();
    const onSelect = vi.fn();

    const view = render(
      <TelegramContextMenu
        canEdit
        messageId="message-1"
        onClose={onClose}
        onCopy={onCopy}
        onDelete={onDelete}
        onEdit={onEdit}
        onForward={onForward}
        onReply={onReply}
        onSelect={onSelect}
        x={32}
        y={48}
      />,
    );

    fireEvent.click(view.getByText('Copy'));
    fireEvent.click(view.getByText('Edit'));
    fireEvent.click(view.getByText('Forward'));
    fireEvent.click(view.getByText('Reply'));
    fireEvent.click(view.getByText('Select'));
    fireEvent.click(view.getByText('Delete'));

    expect(onCopy).toHaveBeenCalledWith('message-1');
    expect(onEdit).toHaveBeenCalledWith('message-1');
    expect(onForward).toHaveBeenCalledWith('message-1');
    expect(onReply).toHaveBeenCalledWith('message-1');
    expect(onSelect).toHaveBeenCalledWith('message-1');
    expect(onDelete).toHaveBeenCalledWith('message-1');
    expect(onClose).toHaveBeenCalledTimes(6);
  });

  it('does not offer edit for messages owned by someone else', () => {
    const view = render(
      <TelegramContextMenu
        canEdit={false}
        messageId="message-1"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onForward={vi.fn()}
        onReply={vi.fn()}
        onSelect={vi.fn()}
        x={32}
        y={48}
      />,
    );

    expect(view.queryByText('Edit')).toBeNull();
  });
});
