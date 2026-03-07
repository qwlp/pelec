const path = require('node:path');
const { spawn } = require('node:child_process');

if (!process.versions.bun) {
  console.error('[forge] This script must be run with Bun.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const shimDir = path.join(rootDir, 'scripts', 'shims');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('[forge] Missing Electron Forge command.');
  process.exit(1);
}

const child = spawn(process.execPath, ['x', 'electron-forge', ...args], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${shimDir}${path.delimiter}${process.env.PATH || ''}`,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[forge] Failed to start Electron Forge:', error);
  process.exit(1);
});
