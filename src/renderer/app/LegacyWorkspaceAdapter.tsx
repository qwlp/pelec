import { useEffect, useRef } from 'react';
import { bootLegacyApp } from '../legacyApp';
import type { LegacyAppBridge } from '../legacyBridge';

interface LegacyWorkspaceAdapterProps {
  bridge: LegacyAppBridge;
}

export const LegacyWorkspaceAdapter = ({ bridge }: LegacyWorkspaceAdapterProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) {
      return;
    }

    mountedRef.current = true;
    void bootLegacyApp(hostRef.current ?? undefined, {
      bridge,
      disableDefaultKeyboardHandling: true,
    });
  }, [bridge]);

  return <div ref={hostRef} className="legacy-app-host modern-legacy-host" />;
};
