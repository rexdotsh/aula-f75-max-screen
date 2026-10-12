import { HIDAsync, devices } from 'node-hid';
import {
  PRODUCT_ID,
  USAGE_PAGE,
  VENDOR_ID,
  accepted,
  acknowledged,
  begin,
  clockCommands,
  commit,
  echoed,
  packet,
  uploadCommands,
  type Animation,
} from './protocol';

const ACK_TIMEOUT_MS = 1000;

export class KeyboardError extends Error {
  override name = 'KeyboardError';
}

export class Keyboard {
  readonly #command: HIDAsync;
  readonly #display: HIDAsync;
  #queue: Promise<void> = Promise.resolve();
  #closed = false;

  private constructor(command: HIDAsync, display: HIDAsync) {
    this.#command = command;
    this.#display = display;
  }

  /** Opens the keyboard, or resolves to `undefined` when it is not plugged in over USB, the only way to the screen. */
  static async open(): Promise<Keyboard | undefined> {
    const found = devices(VENDOR_ID, PRODUCT_ID);
    const path = (page: number) => found.find((device) => device.usagePage === page)?.path;
    const commandPath = path(USAGE_PAGE.command);
    const displayPath = path(USAGE_PAGE.display);
    if (!commandPath || !displayPath) return undefined;
    const command = await HIDAsync.open(commandPath);
    try {
      return new Keyboard(command, await HIDAsync.open(displayPath));
    } catch (error) {
      await command.close();
      throw error;
    }
  }

  /** Replaces the screen's animation. The keyboard shows its own progress screen until the upload commits. */
  upload(animation: Animation, onProgress?: (sent: number, total: number) => void): Promise<void> {
    const { header, chunks } = uploadCommands(animation);
    return this.#transaction(header, async () => {
      await this.#drain();
      for (const [index, chunk] of chunks.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- the keyboard acknowledges each chunk before taking the next
        await this.#write(chunk, `chunk ${index + 1} of ${chunks.length}`);
        onProgress?.(index + 1, chunks.length);
      }
    });
  }

  /** Sets the keyboard clock. The screen switches to the clock page. */
  syncClock(date = new Date()): Promise<void> {
    const { header, payload } = clockCommands(date);
    return this.#transaction(header, async () => {
      const reply = await this.#exchange(payload);
      if (!echoed(payload, reply)) throw new KeyboardError(`clock payload not echoed: ${reply.toHex()}`);
    });
  }

  /** Sends one raw command, zero padded to 64 bytes, and returns the reply. For probing undocumented commands. */
  async exchange(bytes: ArrayLike<number>): Promise<Uint8Array> {
    const command = packet(bytes);
    return this.#serial(() => this.#exchange(command));
  }

  close(): Promise<void> {
    const closing = this.#serial(async () => {
      await Promise.all([this.#command.close(), this.#display.close()]);
    });
    this.#closed = true;
    return closing;
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new KeyboardError('the keyboard is closed'));
    const run = this.#queue.then(work).catch((error: unknown) => {
      throw error instanceof KeyboardError ? error : new KeyboardError('HID transfer failed', { cause: error });
    });
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #transaction(header: Uint8Array, body: () => Promise<void>): Promise<void> {
    return this.#serial(async () => {
      await this.#run(begin());
      await this.#run(header);
      await body();
      await this.#run(commit());
    });
  }

  async #exchange(command: Uint8Array): Promise<Uint8Array> {
    await this.#command.sendFeatureReport(Buffer.from([0, ...command]));
    const reply = await this.#command.getFeatureReport(0, command.length + 1);
    return new Uint8Array(reply.subarray(1));
  }

  async #run(command: Uint8Array): Promise<void> {
    const reply = await this.#exchange(command);
    if (!accepted(command, reply)) {
      throw new KeyboardError(`command ${command.subarray(0, 2).toHex()} rejected: ${reply.subarray(0, 8).toHex()}`);
    }
  }

  // An acknowledgement left over from a failed upload would pair every later chunk with the wrong ack.
  async #drain(): Promise<void> {
    const stale = await this.#display.read(0);
    if (stale?.length) await this.#drain();
  }

  async #write(chunk: Uint8Array, name: string): Promise<void> {
    await this.#display.write(Buffer.from([0, ...chunk]));
    const ack = await this.#display.read(ACK_TIMEOUT_MS);
    if (!ack || !acknowledged(ack))
      throw new KeyboardError(`no acknowledgement for ${name}: ${ack?.toHex() ?? 'timeout'}`);
  }
}
