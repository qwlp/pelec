import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const runtimeDepsToCopy = [
  'tdl',
  'node-gyp-build',
  'node-addon-api',
  'debug',
  'ms',
  'instagram-private-api',
  '@lifeomic/attempt',
  'class-transformer',
  'chance',
  'image-size',
  'json-bigint',
  'lodash',
  'luxon',
  'reflect-metadata',
  'request',
  'request-promise',
  'request-promise-core',
  'oauth-sign',
  'rxjs',
  'snakecase-keys',
  'tough-cookie',
  'tslib',
  'ts-custom-error',
  'ts-xor',
  'url-regex-safe',
  'utility-types',
  'bluebird',
  'ffmpeg-static',
  'ffprobe-static',
  'prebuilt-tdlib',
  '@prebuilt-tdlib/linux-x64-glibc',
];

const copyRuntimeNativeDepsPlugin = () => ({
  name: 'pelec-copy-runtime-native-deps',
  closeBundle() {
    const projectRoot = process.cwd();
    const sourceNodeModules = path.join(projectRoot, 'node_modules');
    const targetNodeModules = path.join(projectRoot, '.vite', 'node_modules');
    fs.mkdirSync(targetNodeModules, { recursive: true });

    for (const dep of runtimeDepsToCopy) {
      const source = path.join(sourceNodeModules, dep);
      const target = path.join(targetNodeModules, dep);
      if (!fs.existsSync(source)) {
        continue;
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true });
    }
  },
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [copyRuntimeNativeDepsPlugin()],
});
