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

let qrCodeModulePromise: Promise<QrCodeRenderer> | null = null;

const loadQrCodeRenderer = async (): Promise<QrCodeRenderer> => {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import('qrcode').then((module) => module.default);
  }

  return qrCodeModulePromise;
};

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
