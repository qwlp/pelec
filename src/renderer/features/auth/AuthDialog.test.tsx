import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { AuthDialog } from './AuthDialog';

describe('AuthDialog', () => {
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

  it('submits and cancels the prompt through callbacks', () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const view = render(
      <AuthDialog
        prompt={{
          label: 'Verification code',
          message: 'Enter the code',
          placeholder: 'Code',
          secret: false,
          stepLabel: 'Step 3 of 3',
          submitLabel: 'Verify',
          title: 'Instagram Verification',
          visible: true,
        }}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByText('Verify'));
    fireEvent.click(view.getByText('Cancel'));

    expect(onSubmit).toHaveBeenCalledWith('');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
