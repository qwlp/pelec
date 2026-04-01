import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { TdClient } from './types';

type TdlModule = {
  default?: {
    createClient?: (config: unknown) => TdClient;
    configure?: (config: { tdjson: string }) => void;
  };
  createClient?: (config: unknown) => TdClient;
  configure?: (config: { tdjson: string }) => void;
};

type PrebuiltTdlibModule = {
  getTdjson?: () => string;
};

type FfmpegStaticModule = { default?: string } | string;

type FfprobeStaticModule = {
  default?: { path?: string };
  path?: string;
};

const importRuntimeModule = async (relativeToNodeModules: string): Promise<unknown> => {
  const candidates = [
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      '.vite',
      'node_modules',
      relativeToNodeModules,
    ),
    path.join(__dirname, '..', 'node_modules', relativeToNodeModules),
    path.join(process.cwd(), 'node_modules', relativeToNodeModules),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    return import(pathToFileURL(candidate).href);
  }

  throw new Error(`Runtime module not found: ${relativeToNodeModules}`);
};

const loadTdlModule = async (): Promise<TdlModule> =>
  (await importRuntimeModule(path.join('tdl', 'dist', 'index.js'))) as TdlModule;

const loadPrebuiltTdlibModule = async (): Promise<PrebuiltTdlibModule> =>
  (await importRuntimeModule(path.join('prebuilt-tdlib', 'index.js'))) as PrebuiltTdlibModule;

const loadFfmpegStaticModule = async (): Promise<FfmpegStaticModule> =>
  (await importRuntimeModule(path.join('ffmpeg-static', 'index.js'))) as FfmpegStaticModule;

const loadFfprobeStaticModule = async (): Promise<FfprobeStaticModule> =>
  (await importRuntimeModule(path.join('ffprobe-static', 'index.js'))) as FfprobeStaticModule;

let ffmpegBinaryPathPromise: Promise<string> | null = null;
let ffprobeBinaryPathPromise: Promise<string> | null = null;

export const getFfmpegBinaryPath = async (): Promise<string> => {
  if (!ffmpegBinaryPathPromise) {
    ffmpegBinaryPathPromise = (async () => {
      const moduleValue = await loadFfmpegStaticModule();
      const binaryPath =
        typeof moduleValue === 'string'
          ? moduleValue
          : typeof moduleValue.default === 'string'
            ? moduleValue.default
            : undefined;
      if (!binaryPath) {
        throw new Error('Bundled ffmpeg binary is unavailable.');
      }
      return binaryPath;
    })();
  }
  return ffmpegBinaryPathPromise;
};

export const getFfprobeBinaryPath = async (): Promise<string> => {
  if (!ffprobeBinaryPathPromise) {
    ffprobeBinaryPathPromise = (async () => {
      const moduleValue = await loadFfprobeStaticModule();
      const binaryPath = moduleValue.path ?? moduleValue.default?.path;
      if (!binaryPath) {
        throw new Error('Bundled ffprobe binary is unavailable.');
      }
      return binaryPath;
    })();
  }
  return ffprobeBinaryPathPromise;
};

export { loadPrebuiltTdlibModule, loadTdlModule };
