import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from '../../test/dom';
import { QrAuthDialog } from './QrAuthDialog';

vi.mock('../../services/qrCode', () => ({
  renderQrCodeToCanvas: vi.fn().mockResolvedValue(undefined),
}));

describe('QrAuthDialog', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('routes refresh, reveal, close, and password submit actions', () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const onRevealPassword = vi.fn();
    const onSubmitPassword = vi.fn();
    const view = render(
      <QrAuthDialog
        qrAuth={{
          network: 'telegram',
          passwordRequired: true,
          qrLink: 'https://example.com/qr',
          visible: true,
        }}
        onClose={onClose}
        onRefresh={onRefresh}
        onRevealPassword={onRevealPassword}
        onSubmitPassword={onSubmitPassword}
      />,
    );

    fireEvent.click(view.getByText('Refresh QR'));
    fireEvent.click(view.getByText('I scanned it'));
    fireEvent.click(view.getByText('Close'));
    fireEvent.click(view.getByText('Submit Password'));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRevealPassword).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmitPassword).toHaveBeenCalledWith('');
  });
});
