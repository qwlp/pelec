const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'out');
const args = new Set(process.argv.slice(2));
const tdjsonSourcePath = path.join(
  rootDir,
  'node_modules',
  '@prebuilt-tdlib',
  'linux-x64-glibc',
  'libtdjson.so',
);

const fail = (message) => {
  console.error(`[appimage] ${message}`);
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

const readPackageMeta = () => {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return {
    name: pkg.productName || pkg.name || 'app',
    version: pkg.version || '0.0.0',
  };
};

const findPrepackagedLinuxApp = (baseName) => {
  const preferred = path.join(outDir, `${baseName}-linux-x64`);
  if (fs.existsSync(preferred) && fs.statSync(preferred).isDirectory()) {
    return preferred;
  }

  if (!fs.existsSync(outDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /-linux-(x64|arm64)$/.test(entry.name))
    .map((entry) => path.join(outDir, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return candidates[0] ?? null;
};

const ensureTdlibResource = (prepackagedPath) => {
  const resourcesDir = path.join(prepackagedPath, 'resources');
  const tdjsonTargetPath = path.join(resourcesDir, 'libtdjson.so');
  if (fs.existsSync(tdjsonTargetPath)) {
    return;
  }
  if (!fs.existsSync(tdjsonSourcePath)) {
    console.warn('[appimage] Warning: libtdjson.so source was not found in node_modules.');
    return;
  }
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.copyFileSync(tdjsonSourcePath, tdjsonTargetPath);
  console.log('[appimage] Injected TDLib shared library into prepackaged resources.');
};

const runBuilder = (prepackagedPath, appName) => {
  const localBuilder =
    process.platform === 'win32'
      ? path.join(rootDir, 'node_modules', '.bin', 'electron-builder.cmd')
      : path.join(rootDir, 'node_modules', '.bin', 'electron-builder');

  const builderArgs = [
    '--linux',
    'AppImage',
    '--x64',
    '--prepackaged',
    prepackagedPath,
    '-c.appId=com.pelec.app',
    `-c.productName=${appName}`,
    '-c.directories.output=out/appimage',
    '-c.artifactName=${productName}-${version}-${arch}.${ext}',
  ];

  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  };

  if (fs.existsSync(localBuilder)) {
    run(localBuilder, builderArgs, { env });
    return;
  }

  run('npx', ['--yes', 'electron-builder', ...builderArgs], { env });
};

if (process.platform !== 'linux') {
  fail('This script must be run on Linux.');
}

const { name, version } = readPackageMeta();
let prepackagedPath = findPrepackagedLinuxApp(name);

if (args.has('--fresh') || !prepackagedPath) {
  console.log('[appimage] Packaging Linux app with Electron Forge...');
  run('npm', ['run', 'package', '--', '--platform=linux', '--arch=x64']);
  prepackagedPath = findPrepackagedLinuxApp(name);
} else {
  console.log('[appimage] Reusing existing prepackaged Linux app.');
}

if (!prepackagedPath) {
  fail('Could not find a prepackaged Linux app under out/.');
}

ensureTdlibResource(prepackagedPath);

console.log(`[appimage] Using prepackaged app: ${path.relative(rootDir, prepackagedPath)}`);
console.log('[appimage] Building AppImage...');
runBuilder(prepackagedPath, name);

console.log(`[appimage] Done. Look in out/appimage/ for ${name} ${version}.`);
