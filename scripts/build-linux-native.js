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

const forgeStartedAt = Date.now();
console.log('[linux-native] Building production Vite bundles with Electron Forge...');
run(process.execPath, [
  path.join('scripts', 'run-forge.js'),
  'package',
  '--platform=linux',
  '--arch=x64',
]);
console.log(
  `[linux-native] Electron Forge production build finished in ${((Date.now() - forgeStartedAt) / 1000).toFixed(1)}s.`,
);

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

if (!fs.existsSync(path.join(builderOutputPath, 'pelec'))) {
  fail('electron-builder did not produce out/linux-unpacked/pelec.');
}

fs.renameSync(builderOutputPath, finalOutputPath);
console.log(`[linux-native] Done. Executable: ${path.relative(rootDir, path.join(finalOutputPath, 'pelec'))}`);
