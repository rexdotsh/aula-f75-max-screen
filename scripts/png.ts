import { deflateSync } from 'node:zlib';
import { HEIGHT, WIDTH, channels, type Frame } from '../src';

const SCALE = 2;
const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The frames side by side as the screen shows them, each pixel drawn twice as large. */
export function png(frames: readonly Frame[]): Uint8Array {
  const width = frames.length * WIDTH * SCALE;
  const height = HEIGHT * SCALE;
  const stride = 1 + width * 3;
  const rows = new Uint8Array(height * stride);
  frames.forEach((frame, index) => {
    frame.pixels.forEach((pixel, at) => {
      const rgb = channels(pixel);
      const left = (index * WIDTH + (at % WIDTH)) * SCALE;
      const top = Math.floor(at / WIDTH) * SCALE;
      for (let y = top; y < top + SCALE; y++) {
        for (let x = left; x < left + SCALE; x++) rows.set(rgb, y * stride + 1 + x * 3);
      }
    });
  });
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]);
}
