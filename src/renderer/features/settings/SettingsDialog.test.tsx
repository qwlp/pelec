import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_CONFIG } from '../../../main/userConfig';
import type { UserConfig } from '../../../shared/types';
import { installDom } from '../../test/dom';
import { SettingsDialog } from './SettingsDialog';

describe('SettingsDialog', () => {
  let cleanupDom: (() => void) | undefined;

  beforeEach(() => {
    cleanupDom = installDom();
    window.pelec = {
      listInstalledFonts: vi.fn().mockResolvedValue([
        'Fira Code',
        'Iosevka',
        'JetBrains Mono',
      ]),
    } as unknown as typeof window.pelec;
  });

  afterEach(() => {
    cleanup();
    cleanupDom?.();
    cleanupDom = undefined;
  });

  it('lets users disable composer Vim mode and disables count configuration with it', async () => {
    let savedConfig: UserConfig | null = null;
    const onSave = vi.fn(async (config: UserConfig) => {
      savedConfig = config;
    });
    const view = render(
      <SettingsDialog
        config={structuredClone(DEFAULT_USER_CONFIG)}
        onClose={vi.fn()}
        onOpenConfigFile={vi.fn()}
        onSave={onSave}
      />,
    );

    const vimToggle = view.getByRole('checkbox', { name: 'Vim mode in composer' });
    const countsToggle = view.getByRole('checkbox', { name: 'Vim-style counts' });
    expect((vimToggle as HTMLInputElement).checked).toBe(true);
    expect((countsToggle as HTMLInputElement).disabled).toBe(false);

    fireEvent.click(vimToggle);
    expect((countsToggle as HTMLInputElement).disabled).toBe(true);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(savedConfig?.keyboard.enableVimMode).toBe(false);
  });

  it('lets users select an installed font family', async () => {
    let savedConfig: UserConfig | null = null;
    const onSave = vi.fn(async (config: UserConfig) => {
      savedConfig = config;
    });
    const view = render(
      <SettingsDialog
        config={structuredClone(DEFAULT_USER_CONFIG)}
        onClose={vi.fn()}
        onOpenConfigFile={vi.fn()}
        onSave={onSave}
      />,
    );

    const fontPicker = await view.findByRole('combobox', { name: 'Font family' });
    await waitFor(() => {
      expect(view.getByText('3 installed fonts')).toBeTruthy();
    });

    fireEvent.click(fontPicker);
    fireEvent.change(view.getByRole('searchbox', { name: 'Search installed fonts' }), {
      target: { value: 'JetBrains' },
    });
    fireEvent.click(view.getByRole('option', { name: 'JetBrains Mono' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(savedConfig?.appearance.fontFamily).toBe('JetBrains Mono');
  });

  it('flushes a pending change when the dialog closes', async () => {
    let savedConfig: UserConfig | null = null;
    const onSave = vi.fn(async (config: UserConfig) => {
      savedConfig = config;
    });
    const onClose = vi.fn();
    const view = render(
      <SettingsDialog
        config={structuredClone(DEFAULT_USER_CONFIG)}
        onClose={onClose}
        onOpenConfigFile={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(view.getByRole('checkbox', { name: 'Show keyboard hints' }));
    fireEvent.click(view.getByRole('button', { name: 'Close settings' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(savedConfig?.keyboard.showHints).toBe(false);
  });
});
