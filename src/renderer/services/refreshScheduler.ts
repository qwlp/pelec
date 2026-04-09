import type { NetworkId } from '../../shared/types';

export interface RefreshScheduleContext {
  activeNetwork: NetworkId;
  authState: 'authenticated' | 'authenticating' | 'degraded' | 'unauthenticated';
  focused: boolean;
  mode: 'api' | 'native' | 'web-fallback';
  network: NetworkId;
  visible: boolean;
}

export const resolveRefreshDelay = ({
  activeNetwork,
  authState,
  focused,
  mode,
  network,
  visible,
}: RefreshScheduleContext): number | null => {
  if (mode !== 'native' || authState !== 'authenticated') {
    return null;
  }

  if (!visible) {
    return 30000;
  }

  if (!focused) {
    return null;
  }

  const isActive = activeNetwork === network;
  if (network === 'telegram') {
    return isActive ? 2500 : 8000;
  }

  return isActive ? 4000 : 12000;
};

export const shouldRefreshActiveMessages = ({
  activeNetwork,
  focused,
  network,
  visible,
}: Pick<RefreshScheduleContext, 'activeNetwork' | 'focused' | 'network' | 'visible'>): boolean =>
  visible && focused && activeNetwork === network;
