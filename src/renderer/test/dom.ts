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

  const previousAttachEvent = Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'attachEvent');
  const previousDetachEvent = Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'detachEvent');
  Object.defineProperty(dom.window.Element.prototype, 'attachEvent', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(dom.window.Element.prototype, 'detachEvent', {
    configurable: true,
    value: () => undefined,
  });

  return () => {
    if (previousAttachEvent) {
      Object.defineProperty(dom.window.Element.prototype, 'attachEvent', previousAttachEvent);
    } else {
      delete (dom.window.Element.prototype as Element & { attachEvent?: unknown }).attachEvent;
    }
    if (previousDetachEvent) {
      Object.defineProperty(dom.window.Element.prototype, 'detachEvent', previousDetachEvent);
    } else {
      delete (dom.window.Element.prototype as Element & { detachEvent?: unknown }).detachEvent;
    }
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
