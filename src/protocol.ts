import { Frame, HEIGHT, WIDTH, type Rgb } from './frame';
import { KEYS, isKey, type Key } from './keys';

export const VENDOR_ID = 0x0c45;
export const PRODUCT_ID = 0x800a;
export const USAGE_PAGE = { command: 0xff13, display: 0xff68 } as const;

const PACKET = 64;
const CHUNK = 4096;
const HEADER = 256;
const FRAME_BYTES = WIDTH * HEIGHT * 2;
const MAX_FRAMES = 255;
const TICK_MS = 2;
const MAX_TICKS = 255;
export const MAX_FRAME_MS = MAX_TICKS * TICK_MS;

// The firmware holds a single animation and always shows the newest upload, whatever slot it names.
const SLOT = 1;
const ACCEPTED = 0x01;
const ACK = Uint8Array.of(0x01, 0x5a, 0x02);

const USER_DEFINED = 0x80;
const MAX_BRIGHTNESS = 5;
const KEY_COLOR_PACKETS = 9;
const TRAILER = [0xaa, 0x55];

const Op = { commit: 0x02, lighting: 0x13, begin: 0x18, keyColors: 0x23, clock: 0x28, upload: 0x72 } as const;

/** A command header and the 64-byte packets after it, each of which the keyboard echoes back. */
export interface Write {
  header: Uint8Array;
  packets: Uint8Array[];
}

/** `count`, if an animation may have that many frames. Check before rendering them. */
export function frameCount(count: number): number {
  if (!(Number.isInteger(count) && count >= 1 && count <= MAX_FRAMES)) {
    throw new RangeError(`an animation has 1-${MAX_FRAMES} frames, not ${count}`);
  }
  return count;
}

function ticks(ms: number): number {
  if (!(ms >= TICK_MS && ms <= MAX_FRAME_MS))
    throw new RangeError(`a frame lasts ${TICK_MS}-${MAX_FRAME_MS}ms, not ${ms}`);
  return Math.round(ms / TICK_MS);
}

/** A snapshot of frames and their display times, checked against the device's limits when built. */
export class Animation {
  readonly #entries: readonly { readonly pixels: Uint16Array; readonly ticks: number }[];

  private constructor(entries: Animation['entries']) {
    this.#entries = entries;
  }

  static of(frames: readonly { frame: Frame; ms: number }[]): Animation {
    frameCount(frames.length);
    return new Animation(
      Array.from(frames, (entry: { frame: Frame; ms: number } | undefined) => {
        if (!(entry?.frame instanceof Frame)) throw new TypeError('every animation entry needs a frame');
        return Object.freeze({ pixels: entry.frame.pixels.slice(), ticks: ticks(entry.ms) });
      }),
    );
  }

  static still(frame: Frame): Animation {
    return Animation.of([{ frame, ms: MAX_FRAME_MS }]);
  }

  get entries(): readonly { readonly pixels: Uint16Array; readonly ticks: number }[] {
    return this.#entries;
  }
}

/** A command packet: `bytes` zero padded to the device's 64-byte report. Anything but whole bytes is refused. */
export function packet(bytes: ArrayLike<number>): Uint8Array {
  if (bytes.length > PACKET) throw new RangeError(`a command is at most ${PACKET} bytes`);
  const padded = new Uint8Array(PACKET);
  Array.from(bytes).forEach((byte, index) => {
    if (!(Number.isInteger(byte) && byte >= 0 && byte <= 0xff)) throw new RangeError(`not a byte: ${byte}`);
    padded[index] = byte;
  });
  return padded;
}

export const begin = () => packet([0x04, Op.begin]);
export const commit = () => packet([0x04, Op.commit]);

export function accepted(command: Uint8Array, reply: Uint8Array): boolean {
  return reply[0] === command[0] && reply[1] === command[1] && reply[3] === ACCEPTED;
}

export function echoed(payload: Uint8Array, reply: Uint8Array): boolean {
  return reply.toHex() === payload.toHex();
}

export function acknowledged(report: Uint8Array): boolean {
  return ACK.every((byte, index) => report[index] === byte);
}

function encode(animation: Animation): Uint8Array {
  const { entries } = animation;
  const stream = new Uint8Array(Math.ceil((HEADER + entries.length * FRAME_BYTES) / CHUNK) * CHUNK);
  const view = new DataView(stream.buffer);
  stream.set([entries.length, ...entries.map((entry) => entry.ticks)]);
  entries.forEach(({ pixels }, index) => {
    const offset = HEADER + index * FRAME_BYTES;
    pixels.forEach((pixel, at) => view.setUint16(offset + at * 2, pixel, true));
  });
  return stream;
}

/** The upload header and the 4096-byte data chunks that follow it on the display interface. */
export function uploadCommands(animation: Animation): { header: Uint8Array; chunks: Uint8Array[] } {
  const stream = encode(animation);
  const chunks = Array.from({ length: stream.length / CHUNK }, (_, index) =>
    stream.subarray(index * CHUNK, (index + 1) * CHUNK),
  );
  const header = packet([0x04, Op.upload, SLOT]);
  new DataView(header.buffer).setUint16(8, chunks.length, true);
  return { header, chunks };
}

function write(op: number, payload: readonly number[]): Write {
  const packets = Array.from({ length: Math.ceil(payload.length / PACKET) }, (_, index) =>
    packet(payload.slice(index * PACKET, (index + 1) * PACKET)),
  );
  return { header: packet([0x04, op, 0, 0, 0, 0, 0, 0, packets.length]), packets };
}

/** `bytes` zero padded to `length`, ending in the `aa 55` trailer the keyboard expects on stored data. */
function trailed(bytes: readonly number[], length: number): number[] {
  return [...bytes, ...Array.from({ length: length - bytes.length - TRAILER.length }, () => 0), ...TRAILER];
}

export function clockCommands(date: Date): Write {
  if (Number.isNaN(date.getTime())) throw new RangeError('cannot set the clock to an invalid date');
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()];
  return write(
    Op.clock,
    trailed([0x00, 0x01, 0x5a, 0x1a, date.getMonth() + 1, date.getDate(), ...time, 0x00, date.getDay()], PACKET),
  );
}

/** Switches the key lights to the user-defined mode, which shows the colours from `keyColorsCommands`. */
export function customLightingCommands(brightness: number): Write {
  if (!(Number.isInteger(brightness) && brightness >= 0 && brightness <= MAX_BRIGHTNESS)) {
    throw new RangeError(`brightness is 0-${MAX_BRIGHTNESS}, not ${brightness}`);
  }
  return write(Op.lighting, trailed([USER_DEFINED, 0, 0, 0, 0, 0, 0, 0, 0, brightness], 16));
}

/** Every key's colour: the keys named in `colors` take theirs, the rest go dark. */
export function keyColorsCommands(colors: Readonly<Partial<Record<Key, Rgb>>>): Write {
  const size = KEY_COLOR_PACKETS * PACKET;
  const table = Array.from({ length: size - TRAILER.length }, () => 0);
  for (const [name, rgb] of Object.entries(colors)) {
    if (!isKey(name)) throw new RangeError(`no key named ${name}`);
    table.splice(KEYS[name] * 4, 4, KEYS[name], ...rgb);
  }
  return write(Op.keyColors, trailed(table, size));
}
