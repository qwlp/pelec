const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.versions.bun) {
  console.error('[linux-native] This script must be run with Bun.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'out');
const builderOutputPath = path.join(outputDir, 'linux-unpacked');
const finalOutputPath = path.join(outputDir, 'pelec-linux-x64');

const fail = (message) => {
  console.error(`[linux-native] ${message}`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (process.platform !== 'linux') {
  fail('This script must be run on Linux.');
}

fs.rmSync(builderOutputPath, { recursive: true, force: true });
fs.rmSync(finalOutputPath, { recursive: true, force: true });

const viteStartedAt = Date.now();
console.log('[linux-native] Building production Vite bundles...');
run(process.execPath, [path.join('scripts', 'build-vite-production.js')]);
console.log(
  `[linux-native] Production Vite build finished in ${((Date.now() - viteStartedAt) / 1000).toFixed(1)}s.`,
);

const builderStartedAt = Date.now();
console.log('[linux-native] Packaging Linux app with electron-builder...');
run(process.execPath, [
  'x',
  'electron-builder',
  '--linux',
  'dir',
  '--x64',
  '--publish',
  'never',
  '--config',
  'scripts/electron-builder-linux.json',
  '-c.directories.output=out',
]);
console.log(
  `[linux-native] electron-builder package finished in ${((Date.now() - builderStartedAt) / 1000).toFixed(1)}s.`,
);

if (!fs.existsSync(path.join(builderOutputPath, 'pelec'))) {
  fail('electron-builder did not produce out/linux-unpacked/pelec.');
}

fs.rmSync(path.join(builderOutputPath, 'resources', 'default_app.asar'), { force: true });
fs.renameSync(builderOutputPath, finalOutputPath);
console.log(`[linux-native] Done. Executable: ${path.relative(rootDir, path.join(finalOutputPath, 'pelec'))}`);
