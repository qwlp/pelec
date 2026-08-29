import { AppShell } from './app/AppShell';
import { AppStoreProvider } from './state/appStore';

export const App = () => {
  return (
    <AppStoreProvider>
      <AppShell />
    </AppStoreProvider>
  );
};
