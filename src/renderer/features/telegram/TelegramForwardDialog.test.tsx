import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { TelegramForwardDialog } from './TelegramForwardDialog';

describe('TelegramForwardDialog', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    Object.defineProperty(window.HTMLElement.prototype, 'attachEvent', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window.HTMLElement.prototype, 'detachEvent', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('routes forward and close actions', () => {
    const onClose = vi.fn();
    const onForward = vi.fn();
    const onQueryChange = vi.fn();

    const view = render(
      <TelegramForwardDialog
        chats={[
          {
            id: 'chat-2',
            title: 'Design',
            lastMessagePreview: 'Latest mock',
            unreadCount: 0,
          },
        ]}
        onClose={onClose}
        onForward={onForward}
        onQueryChange={onQueryChange}
        query=""
        sending={false}
      />,
    );

    fireEvent.click(view.getByText('Design'));
    fireEvent.click(view.getByLabelText('Close forward picker'));

    expect((view.getByPlaceholderText('Search chats') as HTMLInputElement).value).toBe('');
    expect(onForward).toHaveBeenCalledWith('chat-2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
