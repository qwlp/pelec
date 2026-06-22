import { useEffect, useRef } from 'react';
import { renderStatusToast } from '../components/statusToast';
import { useAppState } from '../state/appStore';

export const StatusLayer = () => {
  const state = useAppState();
  const toastHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!toastHostRef.current) {
      return;
    }

    renderStatusToast(toastHostRef.current, state.activity.current);
  }, [state.activity.current]);

  return <div ref={toastHostRef} className="status-toast-host hidden" />;
};
