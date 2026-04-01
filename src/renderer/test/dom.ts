import { JSDOM } from 'jsdom';

const DOM_GLOBAL_KEYS = [
  'window',
  'document',
  'Node',
  'HTMLElement',
  'MouseEvent',
  'localStorage',
  'FileReader',
] as const;

type DomGlobalKey = (typeof DOM_GLOBAL_KEYS)[number];

export const installDom = (): (() => void) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://pelec.test',
  });

  const previousDescriptors = new Map<DomGlobalKey, PropertyDescriptor | undefined>();
  const nextValues: Record<DomGlobalKey, unknown> = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    localStorage: dom.window.localStorage,
    FileReader: dom.window.FileReader,
  };

  for (const key of DOM_GLOBAL_KEYS) {
    previousDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: nextValues[key],
    });
  }

  return () => {
    for (const key of DOM_GLOBAL_KEYS) {
      const descriptor = previousDescriptors.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
    dom.window.close();
  };
};
