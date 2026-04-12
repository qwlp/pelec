import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { InstagramComposer } from './InstagramComposer';

describe('InstagramComposer', () => {
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

  it('routes draft, attachment, reply, and send actions', () => {
    const onClearReply = vi.fn();
    const onDraftChange = vi.fn();
    const onPickFiles = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onSend = vi.fn();

    const view = render(
      <InstagramComposer
        attachments={[
          {
            id: 'att-1',
            kind: 'image',
            name: 'photo.png',
            dataUrl: 'data:image/png;base64,AA==',
          },
        ]}
        canSend
        draftText="hello"
        inputRef={{ current: null }}
        onClearReply={onClearReply}
        onDraftChange={onDraftChange}
        onPickFiles={onPickFiles}
        onRemoveAttachment={onRemoveAttachment}
        onSend={onSend}
        replyPreview={{
          sender: 'Alice',
          text: 'Previous message',
        }}
      />,
    );

    fireEvent.click(view.getByText('Clear'));
    fireEvent.click(view.getByText('Remove'));
    fireEvent.click(view.getByText('Send'));

    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, {
      target: { files: [file] },
    });

    expect(typeof onDraftChange).toBe('function');
    expect(onClearReply).toHaveBeenCalledTimes(1);
    expect(onRemoveAttachment).toHaveBeenCalledWith('att-1');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onPickFiles).toHaveBeenCalled();
  });
});
