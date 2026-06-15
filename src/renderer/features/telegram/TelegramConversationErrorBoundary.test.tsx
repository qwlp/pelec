import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { TelegramConversationErrorBoundary } from './TelegramConversationErrorBoundary';

const BrokenConversation = () => {
  throw new Error('Malformed poll payload');
};

describe('TelegramConversationErrorBoundary', () => {
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

  it('shows actionable chat diagnostics instead of a blank screen', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = render(
      <TelegramConversationErrorBoundary
        activeChatId="group-42"
        activeChatTitle="Operations"
        messageIds={['message-1']}
        target={null}
      >
        <BrokenConversation />
      </TelegramConversationErrorBoundary>,
    );

    expect(view.getByRole('alert')).toHaveTextContent('This conversation could not be displayed.');
    expect(view.getByRole('alert')).toHaveTextContent('Operations (group-42)');
    expect(view.getByRole('alert')).toHaveTextContent('Malformed poll payload');
    expect(errorSpy).toHaveBeenCalledWith(
      '[telegram][conversation-render] Failed to render conversation',
      expect.objectContaining({
        activeChatId: 'group-42',
        activeChatTitle: 'Operations',
        messageCount: 1,
      }),
    );
  });

  it('offers a way back to the chat list', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onBackToChats = vi.fn();

    const view = render(
      <TelegramConversationErrorBoundary
        activeChatId="group-42"
        activeChatTitle="Operations"
        messageIds={[]}
        onBackToChats={onBackToChats}
        target={null}
      >
        <BrokenConversation />
      </TelegramConversationErrorBoundary>,
    );

    fireEvent.click(view.getByRole('button', { name: 'Back to chats' }));
    expect(onBackToChats).toHaveBeenCalledOnce();
  });
});
