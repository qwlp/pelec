import { useEffect, useRef } from 'react';
import { getStatusToastClearDelay, renderStatusToast } from '../components/statusToast';
import { useAppDispatch, useAppState } from '../state/appStore';

export const StatusLayer = () => {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const toastHostRef = useRef<HTMLDivElement | null>(null);
  const activity = state.activity.current;

  useEffect(() => {
    if (!toastHostRef.current) {
      return;
    }

    renderStatusToast(toastHostRef.current, activity);
  }, [activity]);

  useEffect(() => {
    const clearDelay = getStatusToastClearDelay(activity);
    if (clearDelay === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: 'activity/set', activity: null });
    }, clearDelay);

    return () => window.clearTimeout(timeout);
  }, [activity, dispatch]);

  return <div ref={toastHostRef} className="status-toast-host hidden" />;
};
