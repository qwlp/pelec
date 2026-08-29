import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  TelegramCallDevice,
  TelegramCallMetrics,
  TelegramCallParticipant,
  TelegramCallVideoFrame,
} from '../../../shared/connectors';

const MAX_ENGINE_MESSAGE_BYTES = 1024 * 1024;
const ENGINE_REQUEST_TIMEOUT_MS = 10_000;

export type TelegramCallEngineInfo = {
  protocolVersion: number;
  libraryVersions: string[];
  minLayer: number;
  maxLayer: number;
  supportsPrivateVideo: boolean;
  supportsGroupCalls: boolean;
};

export type TelegramCallEngineEvent =
  | { type: 'state'; state: 'connecting' | 'established' | 'reconnecting' | 'failed'; error?: string }
  | { type: 'signaling'; data: string }
  | { type: 'devices'; devices: TelegramCallDevice[] }
  | { type: 'participants'; participants: TelegramCallParticipant[] }
  | { type: 'metrics'; metrics: TelegramCallMetrics }
  | {
      type: 'video-frame';
      endpointId: string;
      width: number;
      height: number;
      timestamp: number;
      data: string;
    }
  | { type: 'group-join-payload'; audioSourceId: number; payload: string };

export interface TelegramCallEngine {
  onEvent(handler: (event: TelegramCallEngineEvent) => void): () => void;
  getInfo(): Promise<TelegramCallEngineInfo>;
  request<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  send(command: string, payload?: Record<string, unknown>): void;
  stop(): Promise<void>;
}

export type TelegramCallEngineVideoFrame = TelegramCallVideoFrame;

type EngineResponse = {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export const encodeCallEngineMessage = (message: unknown): Buffer => {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.byteLength > MAX_ENGINE_MESSAGE_BYTES) {
    throw new Error('Telegram call engine message exceeds the 1 MB limit.');
  }
  const frame = Buffer.allocUnsafe(payload.byteLength + 4);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
};

export const decodeCallEngineMessages = (
  buffer: Buffer,
): { messages: unknown[]; remainder: Buffer } => {
  const messages: unknown[] = [];
  let offset = 0;

  while (buffer.byteLength - offset >= 4) {
    const length = buffer.readUInt32BE(offset);
    if (length > MAX_ENGINE_MESSAGE_BYTES) {
      throw new Error('Telegram call engine sent an oversized message.');
    }
    if (buffer.byteLength - offset - 4 < length) {
      break;
    }
    const payload = buffer.subarray(offset + 4, offset + 4 + length);
    messages.push(JSON.parse(payload.toString('utf8')) as unknown);
    offset += 4 + length;
  }

  return {
    messages,
    remainder: buffer.subarray(offset),
  };
};

const resolveEngineBinary = (): string | undefined => {
  const configured = process.env.PELEC_CALL_ENGINE_PATH?.trim();
  const resourcesPath =
    typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined;
  const candidates = [
    configured,
    resourcesPath && path.join(resourcesPath, 'telegram-calls', 'pelec-call-engine'),
    resourcesPath && path.join(resourcesPath, 'out', 'pelec-call-engine'),
    path.resolve(process.cwd(), 'native/telegram-calls/out/pelec-call-engine'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
};

export class TelegramCallEngineClient implements TelegramCallEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private receiveBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly events = new EventEmitter();
  private stopped = false;

  isAvailable(): boolean {
    return Boolean(resolveEngineBinary());
  }

  onEvent(handler: (event: TelegramCallEngineEvent) => void): () => void {
    this.events.on('event', handler);
    return () => this.events.off('event', handler);
  }

  async getInfo(): Promise<TelegramCallEngineInfo> {
    const info = await this.request<TelegramCallEngineInfo>('getInfo');
    if (!Array.isArray(info.libraryVersions) || info.libraryVersions.length < 1) {
      throw new Error('Telegram call engine is installed without a working tgcalls bridge.');
    }
    return info;
  }

  async request<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
    await this.ensureStarted();
    const child = this.child;
    if (!child) {
      throw new Error('Telegram call engine is unavailable.');
    }

    const id = String(++this.requestSequence);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Telegram call engine command "${command}" timed out.`));
      }, ENGINE_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        child.stdin.write(encodeCallEngineMessage({ id, command, payload: payload ?? {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  send(command: string, payload?: Record<string, unknown>): void {
    void this.request(command, payload).catch((error) => {
      this.events.emit('event', {
        type: 'state',
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      } satisfies TelegramCallEngineEvent);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }
    try {
      child.stdin.write(encodeCallEngineMessage({ command: 'shutdown', payload: {} }));
    } catch {
      // The process may already have closed.
    }
    child.kill('SIGTERM');
    this.rejectPending(new Error('Telegram call engine stopped.'));
  }

  private async ensureStarted(): Promise<void> {
    if (this.child) {
      return;
    }
    this.stopped = false;
    const binary = resolveEngineBinary();
    if (!binary) {
      throw new Error(
        'Telegram call engine is not installed. Build native/telegram-calls for Linux x64.',
      );
    }

    const child = spawn(binary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PELEC_CALL_ENGINE_PROTOCOL: '1',
        PELEC_TGCALLS_BRIDGE_PATH:
          process.env.PELEC_TGCALLS_BRIDGE_PATH ??
          path.join(path.dirname(binary), 'libpelec-tgcalls.so'),
      },
    });
    this.child = child;
    this.receiveBuffer = Buffer.alloc(0);

    child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
        const decoded = decodeCallEngineMessages(this.receiveBuffer);
        this.receiveBuffer = decoded.remainder;
        for (const message of decoded.messages) {
          this.handleMessage(message);
        }
      } catch (error) {
        this.handleExit(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) {
        console.warn('[telegram-call-engine]', message.slice(0, 1000));
      }
    });
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      this.handleExit(
        new Error(`Telegram call engine exited (${signal ?? `code ${String(code)}`}).`),
      );
    });
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const response = message as EngineResponse & { event?: TelegramCallEngineEvent };
    if (response.id) {
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.ok === false) {
        pending.reject(new Error(response.error || 'Telegram call engine command failed.'));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    if (response.event) {
      this.events.emit('event', response.event);
    }
  }

  private handleExit(error: Error): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
    this.rejectPending(error);
    if (!this.stopped) {
      this.events.emit('event', {
        type: 'state',
        state: 'failed',
        error: error.message,
      } satisfies TelegramCallEngineEvent);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
