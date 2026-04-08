import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type PropsWithChildren,
} from 'react';
import { appReducer, initialAppState } from './appReducer';
import type { AppAction, AppState } from './types';

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export const AppStoreProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const stateValue = useMemo(() => state, [state]);

  return (
    <AppDispatchContext.Provider value={dispatch}>
      <AppStateContext.Provider value={stateValue}>{children}</AppStateContext.Provider>
    </AppDispatchContext.Provider>
  );
};

export const useAppState = (): AppState => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStoreProvider');
  }
  return context;
};

export const useAppDispatch = (): Dispatch<AppAction> => {
  const context = useContext(AppDispatchContext);
  if (!context) {
    throw new Error('useAppDispatch must be used within AppStoreProvider');
  }
  return context;
};
