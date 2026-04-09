import type { AppAction, AppState } from './types';

const areSnapshotValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (left == null || right == null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!areSnapshotValuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);

  for (const key of keys) {
    const leftValue = leftRecord[key];
    const rightValue = rightRecord[key];

    if (leftValue === undefined && rightValue === undefined) {
      continue;
    }

    if (!areSnapshotValuesEqual(leftValue, rightValue)) {
      return false;
    }
  }

  return true;
};

export const initialAppState: AppState = {
  activity: {
    current: null,
  },
  appShell: {
    legacyReady: false,
    activeNetwork: 'telegram',
    activePane: 'networks',
    mode: 'normal',
  },
  commandPalette: {
    isOpen: false,
    query: '',
    selectedIndex: 0,
  },
  config: {
    appConfig: null,
    userConfig: null,
    runtimeDiagnostics: null,
  },
  keyboard: {
    showHints: true,
    captureInWebview: false,
    enableCounts: true,
  },
  legacy: {
    snapshot: null,
    commands: [],
  },
  modals: {
    keyboardHelpOpen: false,
  },
};

export const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'config/loaded':
      return {
        ...state,
        config: {
          appConfig: action.appConfig,
          userConfig: action.appConfig.userConfig,
          runtimeDiagnostics: action.runtimeDiagnostics,
        },
      };
    case 'config/toggleSendBehavior': {
      if (!state.config.appConfig || !state.config.userConfig) {
        return state;
      }

      const nextSendBehavior =
        state.config.userConfig.keyboard.sendBehavior === 'enter'
          ? 'mod-enter'
          : 'enter';

      return {
        ...state,
        config: {
          ...state.config,
          appConfig: {
            ...state.config.appConfig,
            userConfig: {
              ...state.config.appConfig.userConfig,
              keyboard: {
                ...state.config.appConfig.userConfig.keyboard,
                sendBehavior: nextSendBehavior,
              },
            },
          },
          userConfig: {
            ...state.config.userConfig,
            keyboard: {
              ...state.config.userConfig.keyboard,
              sendBehavior: nextSendBehavior,
            },
          },
        },
      };
    }
    case 'legacy/ready':
      return {
        ...state,
        appShell: {
          ...state.appShell,
          legacyReady: true,
        },
      };
    case 'legacy/snapshot':
      if (areSnapshotValuesEqual(state.legacy.snapshot, action.snapshot)) {
        return state;
      }

      return {
        ...state,
        appShell: {
          ...state.appShell,
          activeNetwork: action.snapshot.activeNetwork,
          activePane: action.snapshot.activePane,
          mode: state.commandPalette.isOpen ? 'command' : action.snapshot.mode,
        },
        legacy: {
          ...state.legacy,
          snapshot: action.snapshot,
        },
      };
    case 'legacy/commands':
      return {
        ...state,
        legacy: {
          ...state.legacy,
          commands: action.commands,
        },
      };
    case 'activity/set':
      return {
        ...state,
        activity: {
          current: action.activity,
        },
      };
    case 'commandPalette/open':
      return {
        ...state,
        commandPalette: {
          ...state.commandPalette,
          isOpen: true,
          selectedIndex: 0,
        },
        appShell: {
          ...state.appShell,
          mode: 'command',
        },
      };
    case 'commandPalette/close':
      return {
        ...state,
        commandPalette: {
          isOpen: false,
          query: '',
          selectedIndex: 0,
        },
        appShell: {
          ...state.appShell,
          mode: state.legacy.snapshot?.mode ?? 'normal',
        },
      };
    case 'commandPalette/query':
      return {
        ...state,
        commandPalette: {
          ...state.commandPalette,
          query: action.query,
          selectedIndex: 0,
        },
      };
    case 'commandPalette/select':
      return {
        ...state,
        commandPalette: {
          ...state.commandPalette,
          selectedIndex: action.index,
        },
      };
    case 'keyboardHelp/open':
      return {
        ...state,
        modals: {
          ...state.modals,
          keyboardHelpOpen: true,
        },
      };
    case 'keyboardHelp/close':
      return {
        ...state,
        modals: {
          ...state.modals,
          keyboardHelpOpen: false,
        },
      };
    case 'keyboard/config':
      return {
        ...state,
        keyboard: {
          showHints: action.showHints,
          captureInWebview: action.captureInWebview,
          enableCounts: action.enableCounts,
        },
      };
    default:
      return state;
  }
};
