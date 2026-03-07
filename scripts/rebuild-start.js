const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

if (!process.versions.bun) {
  console.error('[rebuild:start] This script must be run with Bun.');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const removeTargets = ['.vite', 'out'];

for (const rel of removeTargets) {
  const target = path.join(rootDir, rel);
  fs.rmSync(target, { recursive: true, force: true });
}

const child = spawn(process.execPath, [path.join('scripts', 'run-forge.js'), 'start'], {
  cwd: rootDir,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
  env: process.env,
});

let stopping = false;

const stopChild = (signal) => {
  if (stopping) {
    return;
  }
  stopping = true;

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('exit', () => process.exit(0));
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    // Process may already be gone.
  }

  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Process may already be gone.
    }
  }, 3000).unref();
};

process.on('SIGINT', () => stopChild('SIGINT'));
process.on('SIGTERM', () => stopChild('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start electron-forge:', error);
  process.exit(1);
});
