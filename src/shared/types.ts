export type AppMode = 'normal' | 'insert';

export type NetworkId = 'telegram' | 'instagram';

export interface NetworkDefinition {
  id: NetworkId;
  name: string;
  partition: string;
  homeUrl: string;
  loginHint: string;
  supportLevel: 'native-web' | 'official-api-fallback';
}

export interface AppConfig {
  version: string;
  networks: NetworkDefinition[];
  shortcuts: {
    forceNormalMode: string;
  };
}
