import { describe, expect, it, vi } from 'vitest';
import { resolveAppShortcutTarget, wireAppShortcutHandling } from './shortcuts';

describe('resolveAppShortcutTarget', () => {
  const shortcuts = {
    openCommandPalette: 'CommandOrControl+K',
    openKeyboardHelp: 'Shift+/',
    telegramNetwork: 'Alt+1',
  };

  it('matches network accelerators', () => {
    expect(
      resolveAppShortcutTarget(
        {
          alt: true,
          code: 'Digit1',
          control: false,
          key: '1',
          meta: false,
          shift: false,
          type: 'keyDown',
        } as Electron.Input,
        shortcuts,
      ),
    ).toBe('telegram');
  });

  it('matches palette accelerators', () => {
    expect(
      resolveAppShortcutTarget(
        {
          alt: false,
          code: 'KeyK',
          control: true,
          key: 'k',
          meta: false,
          shift: false,
          type: 'keyDown',
        } as Electron.Input,
        shortcuts,
      ),
    ).toBe('open-command-palette');
  });

  it('ignores network accelerators when network activation is not wired', () => {
    const listenerByEvent = new Map<string, (event: { preventDefault: () => void }, input: Electron.Input) => void>();
    const contents = {
      on: (eventName: string, listener: (event: { preventDefault: () => void }, input: Electron.Input) => void) => {
        listenerByEvent.set(eventName, listener);
      },
    } as unknown as Electron.WebContents;

    const onOpenCommandPalette = vi.fn();
    const onOpenKeyboardHelp = vi.fn();
    wireAppShortcutHandling(contents, shortcuts, {
      onOpenCommandPalette,
      onOpenKeyboardHelp,
    });

    const beforeInput = listenerByEvent.get('before-input-event');
    expect(beforeInput).toBeTruthy();

    beforeInput?.(
      { preventDefault: vi.fn() },
      {
        alt: true,
        code: 'Digit2',
        control: false,
        key: '2',
        meta: false,
        shift: false,
        type: 'keyDown',
      } as Electron.Input,
    );

    expect(onOpenCommandPalette).not.toHaveBeenCalled();
    expect(onOpenKeyboardHelp).not.toHaveBeenCalled();
  });

  it('activates Telegram when the Telegram shortcut is allowed', () => {
    const listenerByEvent = new Map<string, (event: { preventDefault: () => void }, input: Electron.Input) => void>();
    const contents = {
      on: (eventName: string, listener: (event: { preventDefault: () => void }, input: Electron.Input) => void) => {
        listenerByEvent.set(eventName, listener);
      },
    } as unknown as Electron.WebContents;

    const onActivateNetwork = vi.fn();
    wireAppShortcutHandling(contents, shortcuts, {
      allowNetworkTargets: ['telegram'],
      onActivateNetwork,
      onOpenCommandPalette: vi.fn(),
      onOpenKeyboardHelp: vi.fn(),
    });

    const beforeInput = listenerByEvent.get('before-input-event');
    expect(beforeInput).toBeTruthy();

    beforeInput?.(
      { preventDefault: vi.fn() },
      {
        alt: true,
        code: 'Digit1',
        control: false,
        key: '1',
        meta: false,
        shift: false,
        type: 'keyDown',
      } as Electron.Input,
    );

    expect(onActivateNetwork).toHaveBeenCalledWith('telegram');
  });
});
