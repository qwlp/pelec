declare module 'jsdom' {
  export class JSDOM {
    constructor(
      html?: string | Buffer | ArrayBuffer | ArrayBufferView,
      options?: {
        url?: string;
      },
    );

    window: Window & typeof globalThis;

    serialize(): string;
  }
}
