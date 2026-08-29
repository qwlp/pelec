const fs = require('node:fs');
const path = require('node:path');

process.env.VITE_CJS_IGNORE_WARNING = 'true';

const vite = require('vite');
const ViteConfigGenerator = require('@electron-forge/plugin-vite/dist/ViteConfig').default;

if (!process.versions.bun) {
  console.error('[vite-production] This script must be run with Bun.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

const fail = (message) => {
  console.error(`[vite-production] ${message}`);
  process.exit(1);
};

const forgeConfig = require(path.join(rootDir, 'forge.config.ts')).default;
const vitePlugin = forgeConfig.plugins?.find((plugin) => plugin.name === 'vite');

if (!vitePlugin) {
  fail('Could not find the Electron Forge Vite plugin configuration.');
}

const build = async () => {
  fs.rmSync(path.join(rootDir, '.vite'), { recursive: true, force: true });

  const configGenerator = new ViteConfigGenerator(vitePlugin.config, rootDir, true);
  const buildConfigs = await configGenerator.getBuildConfigs();
  const rendererConfigs = await configGenerator.getRendererConfig();

  await Promise.all([
    ...buildConfigs.map((config) =>
      vite.build({
        configFile: false,
        logLevel: 'error',
        ...config,
      }),
    ),
    ...rendererConfigs.map((config) =>
      vite.build({
        configFile: false,
        logLevel: 'error',
        ...config,
      }),
    ),
  ]);
};

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
