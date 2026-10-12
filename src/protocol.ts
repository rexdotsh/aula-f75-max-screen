import { Frame, HEIGHT, WIDTH } from './frame';

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

const Op = { commit: 0x02, begin: 0x18, clock: 0x28, upload: 0x72 } as const;

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

/** The clock header and the payload that sets the time; the keyboard echoes the payload back. */
export function clockCommands(date: Date): { header: Uint8Array; payload: Uint8Array } {
  if (Number.isNaN(date.getTime())) throw new RangeError('cannot set the clock to an invalid date');
  const header = packet([0x04, Op.clock]);
  header[8] = 0x01;
  const payload = packet([
    0x00,
    0x01,
    0x5a,
    0x1a,
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    0x00,
    date.getDay(),
  ]);
  payload.set([0xaa, 0x55], PACKET - 2);
  return { header, payload };
}
