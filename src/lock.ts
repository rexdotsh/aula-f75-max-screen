import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LockOptions {
  path: string;
  /** How long to wait for another holder before giving up. */
  timeoutMs: number;
}

const POLL_MS = 20;

// A 255-frame upload takes about five minutes, and a caller queued behind it should still get its turn.
const DEFAULT_LOCK: LockOptions = { path: join(tmpdir(), 'aula-f75-max-screen.lock'), timeoutMs: 10 * 60_000 };

export class LockTimeoutError extends Error {
  override name = 'LockTimeoutError';
}

const code = (error: unknown) => (error instanceof Error && 'code' in error ? error.code : undefined);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function holder(path: string): number | undefined {
  try {
    const pid = Number(readFileSync(path, 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) {
    if (code(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return code(error) === 'EPERM';
  }
}

function tryAcquire(path: string): boolean {
  try {
    const fd = openSync(path, 'wx');
    try {
      writeSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (error) {
    if (code(error) === 'EEXIST') return false;
    throw error;
  }
}

async function acquire({ path, timeoutMs }: LockOptions): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!tryAcquire(path)) {
    const pid = holder(path);
    // A holder that died mid-operation leaves its file behind; re-read it so a lock taken since is never removed.
    if (pid !== undefined && !alive(pid) && holder(path) === pid) {
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new LockTimeoutError(`the keyboard is busy in process ${pid ?? 'unknown'}`);
    // oxlint-disable-next-line no-await-in-loop -- polling until the holder lets go
    await sleep(POLL_MS);
  }
}

/** Runs `work` while holding the keyboard's lock, which every process driving the keyboard takes. */
export async function withLock<T>(work: () => Promise<T>, options: LockOptions = DEFAULT_LOCK): Promise<T> {
  await acquire(options);
  try {
    return await work();
  } finally {
    if (holder(options.path) === process.pid) rmSync(options.path, { force: true });
  }
}
