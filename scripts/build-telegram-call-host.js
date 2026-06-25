import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const nativeRoot = path.join(root, 'native', 'telegram-calls');
const outDir = path.join(nativeRoot, 'out');
let bazel =
  process.env.BAZEL ??
  ['bazel-8.4.2', 'bazel'].find((candidate) => {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  });

if (!bazel) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    console.error('[telegram-calls] Set BAZEL=/path/to/bazel-8.4.2 on this platform.');
    process.exit(1);
  }
  const lock = JSON.parse(
    fs.readFileSync(path.join(nativeRoot, 'dependencies.lock.json'), 'utf8'),
  );
  const toolsDir = path.join(root, '.cache', 'tools');
  const downloaded = path.join(toolsDir, 'bazel-8.4.2-linux-x86_64');
  fs.mkdirSync(toolsDir, { recursive: true });
  if (!fs.existsSync(downloaded)) {
    const url =
      'https://github.com/bazelbuild/bazel/releases/download/8.4.2/bazel-8.4.2-linux-x86_64';
    console.log('[telegram-calls] Downloading Bazel 8.4.2...');
    const result = spawnSync('curl', ['-fL', url, '-o', downloaded], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(downloaded))
    .digest('hex');
  if (digest !== lock.bazel.sha256['linux-x86_64']) {
    fs.rmSync(downloaded, { force: true });
    console.error('[telegram-calls] Bazel checksum verification failed.');
    process.exit(1);
  }
  fs.chmodSync(downloaded, 0o755);
  bazel = downloaded;
}

const result = spawnSync(
  bazel,
  ['build', '//:pelec-call-engine', '--enable_bzlmod', '--repo_env=CC=gcc'],
  { cwd: nativeRoot, stdio: 'inherit' },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.mkdirSync(outDir, { recursive: true });
const source = path.join(nativeRoot, 'bazel-bin', 'pelec-call-engine');
const target = path.join(outDir, 'pelec-call-engine');
fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);
console.log(`[telegram-calls] Built ${path.relative(root, target)}`);
