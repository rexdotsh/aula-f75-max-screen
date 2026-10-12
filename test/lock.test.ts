import { afterEach, expect, test } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockTimeoutError, withLock } from '../src/lock';

const path = join(tmpdir(), `aula-lock-test-${process.pid}.lock`);
const options = { path, timeoutMs: 200 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => rmSync(path, { force: true }));

test('two holders never overlap, and the lock is gone afterwards', async () => {
  const log: string[] = [];
  const hold = (name: string) =>
    withLock(async () => {
      log.push(`${name} in`);
      await sleep(30);
      log.push(`${name} out`);
    }, options);
  await Promise.all([hold('a'), hold('b')]);
  expect(log).toEqual(['a in', 'a out', 'b in', 'b out']);
  expect(existsSync(path)).toBe(false);
});

test('a lock left by a process that died is taken over', async () => {
  writeFileSync(path, String(2 ** 31 - 2));
  expect(await withLock(async () => 'ran', options)).toBe('ran');
});

test('a lock held by a live process times out instead of being stolen', async () => {
  writeFileSync(path, String(process.ppid));
  expect(withLock(async () => 'ran', options)).rejects.toBeInstanceOf(LockTimeoutError);
  await sleep(300);
  expect(existsSync(path)).toBe(true);
});

test('the lock is released when the work fails', async () => {
  expect(withLock(() => Promise.reject(new Error('boom')), options)).rejects.toThrow('boom');
  await sleep(10);
  expect(existsSync(path)).toBe(false);
});
