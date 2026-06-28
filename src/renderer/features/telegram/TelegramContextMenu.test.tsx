import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { TelegramContextMenu } from './TelegramContextMenu';

describe('TelegramContextMenu', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    window.localStorage.clear();
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
    const onReact = vi.fn();
    const onReply = vi.fn();
    const onSelect = vi.fn();

    const view = render(
      <TelegramContextMenu
        canEdit
        currentReactions={[{ value: '👍', count: 1, chosen: true }]}
        messageId="message-1"
        onClose={onClose}
        onCopy={onCopy}
        onDelete={onDelete}
        onEdit={onEdit}
        onForward={onForward}
        onReact={onReact}
        onReply={onReply}
        onSelect={onSelect}
        x={32}
        y={48}
      />,
    );

    fireEvent.click(view.getByText('👍'));
    fireEvent.click(view.getByText('Copy'));
    fireEvent.click(view.getByText('Edit'));
    fireEvent.click(view.getByText('Forward'));
    fireEvent.click(view.getByText('Reply'));
    fireEvent.click(view.getByText('Select'));
    fireEvent.click(view.getByText('Delete'));

    expect(onReact).toHaveBeenCalledWith('message-1', '👍');
    expect(onCopy).toHaveBeenCalledWith('message-1');
    expect(onEdit).toHaveBeenCalledWith('message-1');
    expect(onForward).toHaveBeenCalledWith('message-1');
    expect(onReply).toHaveBeenCalledWith('message-1');
    expect(onSelect).toHaveBeenCalledWith('message-1');
    expect(onDelete).toHaveBeenCalledWith('message-1');
    expect(onClose).toHaveBeenCalledTimes(7);
    expect(view.getByText('👍').classList.contains('chosen')).toBe(true);
  });

  it('does not offer edit for messages owned by someone else', () => {
    const view = render(
      <TelegramContextMenu
        canEdit={false}
        currentReactions={[]}
        messageId="message-1"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onForward={vi.fn()}
        onReact={vi.fn()}
        onReply={vi.fn()}
        onSelect={vi.fn()}
        x={32}
        y={48}
      />,
    );

    expect(view.queryByText('Edit')).toBeNull();
  });

  it('orders quick reactions by recency and promotes picker choices', () => {
    window.localStorage.setItem(
      'pelec.telegramRecentReactions',
      JSON.stringify(['🔥', '👏']),
    );
    const onReact = vi.fn();

    const view = render(
      <TelegramContextMenu
        canEdit={false}
        currentReactions={[]}
        messageId="message-1"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onForward={vi.fn()}
        onReact={onReact}
        onReply={vi.fn()}
        onSelect={vi.fn()}
        x={32}
        y={48}
      />,
    );

    const quickReactions = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>(
        '.telegram-context-menu-reactions .telegram-context-menu-reaction:not(.more)',
      ),
    ).map((button) => button.textContent);
    expect(quickReactions.slice(0, 2)).toEqual(['🔥', '👏']);

    fireEvent.click(view.getByLabelText('More reactions'));
    fireEvent.click(view.getByText('💯'));

    expect(onReact).toHaveBeenCalledWith('message-1', '💯');
    expect(JSON.parse(window.localStorage.getItem('pelec.telegramRecentReactions') ?? '[]')[0]).toBe(
      '💯',
    );
  });
});
