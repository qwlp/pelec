import { useEffect, useRef, useState } from 'react';
import type { LegacyQrAuthState } from '../../legacyBridge';
import { renderQrCodeToCanvas } from '../../services/qrCode';

interface QrAuthDialogProps {
  qrAuth: LegacyQrAuthState;
  onClose(): void;
  onRefresh(): void;
  onRevealPassword(): void;
  onSubmitPassword(value: string): void;
}

export const QrAuthDialog = ({
  qrAuth,
  onClose,
  onRefresh,
  onRevealPassword,
  onSubmitPassword,
}: QrAuthDialogProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    setPassword('');
  }, [qrAuth.network, qrAuth.qrLink, qrAuth.passwordRequired]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = 260;
    canvas.height = 260;
    canvas.style.width = '260px';
    canvas.style.height = '260px';

    if (!qrAuth.qrLink) {
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    void renderQrCodeToCanvas(canvas, qrAuth.qrLink, { margin: 1, width: 260 });
  }, [qrAuth.qrLink]);

  return (
    <div className="qr-modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="qr-card">
        <h3>Authenticate {qrAuth.network}</h3>
        <p className="qr-subtitle">Scan the QR code in your Telegram app.</p>
        <canvas ref={canvasRef} id="qr-canvas" />
        <div className="qr-primary-actions">
          <button type="button" className="ghost-button" onClick={onRefresh}>
            Refresh QR
          </button>
          <button type="button" className="ghost-button" onClick={onRevealPassword}>
            I scanned it
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        {qrAuth.passwordRequired ? (
          <div className="qr-password-wrap">
            <input
              className="quick-filter"
              type="password"
              placeholder="2FA password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSubmitPassword(password);
                }
              }}
            />
            <div className="qr-actions">
              <button type="button" className="ghost-button" onClick={() => onSubmitPassword(password)}>
                Submit Password
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
