import { createElement } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatTextEntity } from '../../../shared/connectors';
import { buildLinkedTextNodes, renderTelegramRichText } from './links';
import { installDom } from '../../test/dom';

describe('buildLinkedTextNodes', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    window.pelec = {
      openExternal: vi.fn().mockResolvedValue(true),
    } as unknown as typeof window.pelec;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('wraps supported links and preserves trailing punctuation', () => {
    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('See www.example.com, please.'));

    const link = host.querySelector('a');
    expect(link?.textContent).toBe('www.example.com');
    expect(link?.getAttribute('href')).toBe('https://www.example.com');
    expect(host.textContent).toBe('See www.example.com, please.');
  });

  it('opens links through the preload bridge instead of direct navigation', () => {
    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('https://pelec.test'));

    const link = host.querySelector('a');
    expect(link).not.toBeNull();

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(window.pelec.openExternal).toHaveBeenCalledWith('https://pelec.test');
  });

  it('renders markdown formatting in DOM nodes', () => {
    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('**Bold** and `code`'));

    expect(host.querySelector('strong')?.textContent).toBe('Bold');
    expect(host.querySelector('code')?.textContent).toBe('code');
  });

  it('renders urls and markdown in the React message list formatter', () => {
    const view = render(
      createElement(
        'div',
        { className: 'telegram-message-text' },
        renderTelegramRichText('Visit [pelec](https://pelec.test) and **bold**'),
      ),
    );

    const link = view.container.querySelector('a');
    expect(link?.textContent).toBe('pelec');
    expect(link?.getAttribute('href')).toBe('https://pelec.test');
    expect(view.container.querySelector('strong')?.textContent).toBe('bold');

    fireEvent.click(link as Element);
    expect(window.pelec.openExternal).toHaveBeenCalledWith('https://pelec.test');
  });

  it('renders highlighted code blocks with a copy button in DOM nodes', async () => {
    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('```js\nconst answer = 42;\n```'));

    const copyButton = host.querySelector<HTMLButtonElement>('.telegram-message-code-copy');
    expect(copyButton?.textContent).toBe('Copy');
    expect(
      [...host.querySelectorAll('.telegram-code-token.token-keyword')].some(
        (node) => node.textContent === 'const',
      ),
    ).toBe(true);

    fireEvent.click(copyButton as HTMLButtonElement);

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('const answer = 42;');
    });
  });

  it('renders highlighted code blocks with a copy button in React output', async () => {
    const view = render(
      createElement(
        'div',
        { className: 'telegram-message-text' },
        renderTelegramRichText('```json\n{"ok": true}\n```'),
      ),
    );

    const copyButton = view.container.querySelector<HTMLButtonElement>('.telegram-message-code-copy');
    expect(copyButton?.textContent).toBe('Copy');
    expect(view.container.querySelector('.telegram-code-token.token-key')?.textContent).toBe('"ok"');

    fireEvent.click(copyButton as HTMLButtonElement);

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('{"ok": true}');
    });
  });

  it('renders Telegram preformatted entities as code blocks', () => {
    const entities: ChatTextEntity[] = [
      {
        offset: 0,
        length: 'git clone'.length,
        type: 'preCode',
        language: 'bash',
      },
    ];

    const host = document.createElement('div');
    host.replaceChildren(...buildLinkedTextNodes('git clone', entities));

    expect(host.querySelector('.telegram-message-code-language')?.textContent).toBe('bash');
    expect(host.querySelector('.telegram-message-code-block')?.textContent).toContain('git clone');
  });
});
