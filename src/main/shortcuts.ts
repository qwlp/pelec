import type { WebContents } from 'electron';
import type { NetworkId } from '../shared/types';

export const resolveNetworkShortcutTarget = (input: Electron.Input): NetworkId | null => {
  if (
    input.type !== 'keyDown' ||
    !input.alt ||
    input.control ||
    input.meta ||
    input.shift
  ) {
    return null;
  }

  if (input.key === '1') {
    return 'telegram';
  }

  if (input.key === '2') {
    return 'instagram';
  }

  return null;
};

export const wireNetworkShortcutHandling = (
  contents: WebContents,
  onActivateNetwork: (network: NetworkId) => void,
): void => {
  contents.on('before-input-event', (event, input) => {
    const target = resolveNetworkShortcutTarget(input);
    if (!target) {
      return;
    }

    event.preventDefault();
    onActivateNetwork(target);
  });
};
