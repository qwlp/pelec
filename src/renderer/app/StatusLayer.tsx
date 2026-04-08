import { useMemo } from 'react';
import { useAppState } from '../state/appStore';
import { selectDisplayMode } from '../state/selectors';

export const StatusLayer = () => {
  const state = useAppState();
  const mode = selectDisplayMode(state);
  const hint = useMemo(() => {
    if (!state.keyboard.showHints) {
      return null;
    }

    if (mode === 'command') {
      return 'Type a command and press Enter.';
    }

    if (mode === 'insert') {
      return state.config.userConfig?.keyboard.sendBehavior === 'mod-enter'
        ? 'Compose mode. Mod+Enter sends.'
        : 'Compose mode. Enter sends, Shift+Enter inserts a newline.';
    }

    return 'Normal mode. Press ? for shortcuts or Ctrl/Cmd+K for commands.';
  }, [mode, state.config.userConfig?.keyboard.sendBehavior, state.keyboard.showHints]);

  return (
    <div className="modern-status-layer">
      <div className="modern-status-chip">{mode.toUpperCase()}</div>
      <div className="modern-status-chip">{state.appShell.activeNetwork.toUpperCase()}</div>
      <div className="modern-status-chip subtle">{state.appShell.activePane}</div>
      {hint ? <div className="modern-status-hint">{hint}</div> : null}
      {state.activity.current ? (
        <div className="modern-status-activity">
          <strong>{state.activity.current.label}</strong>
          <span>{state.activity.current.detail ?? state.activity.current.state}</span>
        </div>
      ) : null}
    </div>
  );
};
