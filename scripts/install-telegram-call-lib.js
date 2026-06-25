import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const nativeRoot = path.join(root, 'native', 'telegram-calls');
const outDir = path.join(nativeRoot, 'out');
const cacheDir = path.join(root, '.cache', 'telegram-calls');
const lock = JSON.parse(
  fs.readFileSync(path.join(nativeRoot, 'dependencies.lock.json'), 'utf8'),
);

const fail = (message) => {
  console.error(`[telegram-calls] ${message}`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const sha256 = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const download = (url, target, expectedSha256) => {
  if (fs.existsSync(target) && sha256(target) === expectedSha256) {
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  run('curl', ['-fL', '--retry', '3', url, '-o', target]);
  if (sha256(target) !== expectedSha256) {
    fs.rmSync(target, { force: true });
    fail(`Checksum verification failed for ${path.basename(target)}.`);
  }
};

if (process.env.PELEC_SKIP_CALLS_INSTALL === '1') {
  console.log('[telegram-calls] Skipping native call install by request.');
  process.exit(0);
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.log(
    `[telegram-calls] Prebuilt media engine is unavailable for ${process.platform}-${process.arch}; skipping.`,
  );
  process.exit(0);
}

for (const [command, versionArgs] of [
  ['curl', ['--version']],
  ['unzip', ['-v']],
  ['g++', ['--version']],
]) {
  const result = spawnSync(command, versionArgs, { stdio: 'ignore' });
  if (result.status !== 0) {
    fail(`${command} is required to install the Linux Telegram call engine.`);
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

const ntg = lock.mediaEngine.ntgcalls;
const archivePath = path.join(cacheDir, ntg.asset);
download(ntg.url, archivePath, ntg.sha256);

const extractedDir = path.join(cacheDir, `ntgcalls-${ntg.version}`);
if (
  !fs.existsSync(path.join(extractedDir, 'lib', 'libntgcalls.so')) ||
  sha256(path.join(extractedDir, 'lib', 'libntgcalls.so')) !== ntg.librarySha256
) {
  fs.rmSync(extractedDir, { recursive: true, force: true });
  fs.mkdirSync(extractedDir, { recursive: true });
  run('unzip', ['-q', archivePath, '-d', extractedDir]);
}

const ntgcallsLibrary = path.join(extractedDir, 'lib', 'libntgcalls.so');
if (sha256(ntgcallsLibrary) !== ntg.librarySha256) {
  fail('Extracted libntgcalls.so checksum verification failed.');
}
fs.copyFileSync(ntgcallsLibrary, path.join(outDir, 'libntgcalls.so'));
fs.chmodSync(path.join(outDir, 'libntgcalls.so'), 0o755);

const json = lock.buildDependencies.nlohmannJson;
const jsonHeader = path.join(cacheDir, 'include', 'nlohmann', 'json.hpp');
download(json.url, jsonHeader, json.sha256);

download(
  ntg.licenseUrl,
  path.join(outDir, 'LICENSE.ntgcalls.txt'),
  ntg.licenseSha256,
);

const includeArgs = [
  `-I${path.join(nativeRoot, 'include')}`,
  `-I${path.join(nativeRoot, 'vendor')}`,
  `-I${path.join(cacheDir, 'include')}`,
];

run('g++', [
  '-std=c++20',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-fPIC',
  '-shared',
  path.join(nativeRoot, 'src', 'ntgcalls_bridge.cpp'),
  ...includeArgs,
  `-L${outDir}`,
  '-lntgcalls',
  '-Wl,-rpath,$ORIGIN',
  '-pthread',
  '-o',
  path.join(outDir, 'libpelec-tgcalls.so'),
]);

run('g++', [
  '-std=c++17',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Werror',
  path.join(nativeRoot, 'src', 'main.cpp'),
  ...includeArgs,
  '-ldl',
  '-pthread',
  '-o',
  path.join(outDir, 'pelec-call-engine'),
]);
fs.chmodSync(path.join(outDir, 'pelec-call-engine'), 0o755);

fs.writeFileSync(
  path.join(outDir, 'installation.json'),
  `${JSON.stringify(
    {
      installedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      implementation: 'ntgcalls',
      version: ntg.version,
      sourceCommit: ntg.commit,
      assetSha256: ntg.sha256,
      librarySha256: ntg.librarySha256,
      bridgeAbi: lock.bridgeAbi,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `[telegram-calls] Installed NTgCalls ${ntg.version} and PELEC bridge in native/telegram-calls/out.`,
);
