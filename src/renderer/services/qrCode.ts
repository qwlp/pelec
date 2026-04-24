import QRCode from 'qrcode';

interface QrCodeRenderer {
  toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: {
      margin?: number;
      width?: number;
    },
  ): Promise<void>;
}

const loadQrCodeRenderer = async (): Promise<QrCodeRenderer> => QRCode as QrCodeRenderer;

export const renderQrCodeToCanvas = async (
  canvas: HTMLCanvasElement,
  text: string,
  options?: {
    margin?: number;
    width?: number;
  },
): Promise<void> => {
  const renderer = await loadQrCodeRenderer();
  await renderer.toCanvas(canvas, text, options);
};
