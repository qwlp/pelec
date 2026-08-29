import type { AppConfig, RuntimeDiagnostics } from '../../shared/types';

export interface RendererBootstrapData {
  appConfig: AppConfig;
  runtimeDiagnostics: RuntimeDiagnostics | null;
}

export const loadRendererBootstrapData = async (): Promise<RendererBootstrapData> => {
  const [appConfig, runtimeDiagnostics] = await Promise.all([
    window.pelec.getConfig(),
    window.pelec.getRuntimeDiagnostics(),
  ]);

  return {
    appConfig,
    runtimeDiagnostics,
  };
};
