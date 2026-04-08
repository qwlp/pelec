import { describe, expect, it } from 'vitest';
import { resolveRefreshDelay, shouldRefreshActiveMessages } from './refreshScheduler';

describe('refreshScheduler', () => {
  it('uses the foreground active cadence for telegram', () => {
    expect(
      resolveRefreshDelay({
        activeNetwork: 'telegram',
        authState: 'authenticated',
        focused: true,
        mode: 'native',
        network: 'telegram',
        visible: true,
      }),
    ).toBe(2500);
  });

  it('backs off when the window is hidden', () => {
    expect(
      resolveRefreshDelay({
        activeNetwork: 'telegram',
        authState: 'authenticated',
        focused: false,
        mode: 'native',
        network: 'telegram',
        visible: false,
      }),
    ).toBe(30000);
  });

  it('refreshes active messages only when active and foregrounded', () => {
    expect(
      shouldRefreshActiveMessages({
        activeNetwork: 'telegram',
        focused: true,
        network: 'telegram',
        visible: true,
      }),
    ).toBe(true);

    expect(
      shouldRefreshActiveMessages({
        activeNetwork: 'telegram',
        focused: false,
        network: 'telegram',
        visible: true,
      }),
    ).toBe(false);
  });
});
