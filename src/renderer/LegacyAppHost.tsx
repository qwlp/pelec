import { useEffect, useRef } from 'react';
import { bootLegacyApp } from './legacyApp';

export const LegacyAppHost = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) {
      return;
    }

    mountedRef.current = true;
    void bootLegacyApp(hostRef.current ?? undefined);
  }, []);

  return <div ref={hostRef} className="legacy-app-host" />;
};
