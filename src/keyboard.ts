import { HIDAsync, devicesAsync } from 'node-hid';
import {
  PRODUCT_ID,
  USAGE_PAGE,
  VENDOR_ID,
  accepted,
  acknowledged,
  begin,
  clockCommands,
  commit,
  customLightingCommands,
  echoed,
  keyColorsCommands,
  packet,
  uploadCommands,
  type Animation,
  type Write,
} from './protocol';
import type { Rgb } from './frame';
import type { Key } from './keys';
import { withLock } from './lock';

const ACK_TIMEOUT_MS = 1000;

export class KeyboardError extends Error {
  override name = 'KeyboardError';
}

function keyboardError(error: unknown, message: string): KeyboardError {
  return error instanceof KeyboardError ? error : new KeyboardError(message, { cause: error });
}

const settled = () => undefined;

async function openPair(commandPath: string, displayPath: string): Promise<[HIDAsync, HIDAsync]> {
  const command = await HIDAsync.open(commandPath);
  try {
    return [command, await HIDAsync.open(displayPath)];
  } catch (error) {
    await command.close().catch((closing: unknown) => {
      throw new AggregateError(
        [error, closing],
        'opening the display interface and closing the command one both failed',
        {
          cause: error,
        },
      );
    });
    throw error;
  }
}

export class Keyboard {
  readonly #command: HIDAsync;
  readonly #display: HIDAsync;
  #queue: Promise<void> = Promise.resolve();
  #broken = false;
  #closing: Promise<void> | undefined;

  private constructor([command, display]: [HIDAsync, HIDAsync]) {
    this.#command = command;
    this.#display = display;
  }

  /** Opens the keyboard, or resolves to `undefined` when it is not plugged in over USB, the only way to the screen. */
  static async open(): Promise<Keyboard | undefined> {
    try {
      const found = await devicesAsync(VENDOR_ID, PRODUCT_ID);
      const paths = (page: number) =>
        found.flatMap((device) => (device.usagePage === page && device.path ? [device.path] : []));
      const commands = paths(USAGE_PAGE.command);
      const displays = paths(USAGE_PAGE.display);
      const [command] = commands;
      const [display] = displays;
      if (!command || !display) return undefined;
      // Nothing ties a command interface to its display interface, so two keyboards cannot be paired safely.
      if (commands.length > 1 || displays.length > 1) throw new KeyboardError('more than one keyboard is plugged in');
      return new Keyboard(await openPair(command, display));
    } catch (error) {
      throw keyboardError(error, 'could not open the keyboard');
    }
  }

  /** Replaces the screen's animation. The keyboard shows its own progress screen until the upload commits. */
  upload(animation: Animation, onProgress?: (sent: number, total: number) => void): Promise<void> {
    return this.#serial(async () => {
      const { header, chunks } = uploadCommands(animation);
      await this.#drain();
      await this.#transaction(header, async () => {
        for (const [index, chunk] of chunks.entries()) {
          // oxlint-disable-next-line no-await-in-loop -- the keyboard acknowledges each chunk before taking the next
          await this.#write(chunk, `chunk ${index + 1} of ${chunks.length}`);
          onProgress?.(index + 1, chunks.length);
        }
      });
    });
  }

  /** Sets the keyboard clock to `date`, or to the time the sync runs. The screen switches to the clock page. */
  async syncClock(date?: Date): Promise<void> {
    const fixed = date && clockCommands(date);
    return this.#serial(() => this.#store(fixed ?? clockCommands(new Date())));
  }

  /** Switches the key lights from the current effect to the colours set with `setKeyColors`, at brightness 0-5. */
  async customLighting(brightness = 5): Promise<void> {
    const commands = customLightingCommands(brightness);
    return this.#serial(() => this.#store(commands));
  }

  /** Sets every key's colour for the custom lighting: the keys named take theirs, the rest go dark. */
  async setKeyColors(colors: Readonly<Partial<Record<Key, Rgb>>>): Promise<void> {
    const commands = keyColorsCommands(colors);
    return this.#serial(() => this.#store(commands));
  }

  /** Sends one raw command, zero padded to 64 bytes, and returns the reply. For probing undocumented commands. */
  async exchange(bytes: ArrayLike<number>): Promise<Uint8Array> {
    const command = packet(bytes);
    return this.#serial(() => this.#exchange(command));
  }

  /** Closes the keyboard once queued work has finished. Later calls reject. */
  close(): Promise<void> {
    this.#closing ??= this.#queue
      .then(() => Promise.all([this.#command.close(), this.#display.close()]))
      .then(settled, (error: unknown) => {
        throw keyboardError(error, 'could not close the keyboard');
      });
    return this.#closing;
  }

  // After a failed transfer the keyboard may still answer it late, and every acknowledgement looks the same, so
  // nothing more is sent on this connection: queued work is refused and the caller has to reopen. Waiting for another
  // process to let go of the keyboard sends nothing, so timing out there leaves the connection usable.
  #serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closing) return Promise.reject(new KeyboardError('the keyboard is closed'));
    const run = this.#queue.then(async () => {
      if (this.#broken) throw new KeyboardError('an earlier transfer failed; close and reopen the keyboard');
      const transfer = async () => {
        try {
          return await work();
        } catch (error) {
          this.#broken = true;
          throw keyboardError(error, 'HID transfer failed');
        }
      };
      return withLock(transfer).catch((error: unknown) => {
        throw keyboardError(error, 'the keyboard is busy in another process');
      });
    });
    this.#queue = run.then(settled, settled);
    return run;
  }

  async #transaction(header: Uint8Array, body: () => Promise<void>): Promise<void> {
    await this.#run(begin());
    await this.#run(header);
    await body();
    await this.#run(commit());
  }

  #store({ header, packets }: Write): Promise<void> {
    return this.#transaction(header, async () => {
      for (const data of packets) {
        // oxlint-disable-next-line no-await-in-loop -- each packet is echoed before the next is sent
        const reply = await this.#exchange(data);
        if (!echoed(data, reply)) throw new KeyboardError(`packet not echoed: ${reply.toHex()}`);
      }
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

  // Every open handle receives every acknowledgement, so one waiting on the lock collects another process's. That
  // process released the lock only after its last acknowledgement, so under the lock these are all already here.
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
