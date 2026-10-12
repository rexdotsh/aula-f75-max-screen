import { expect, test } from 'bun:test';
import { Animation, Frame, rgb } from '../src';
import { accepted, acknowledged, clockCommands, packet, uploadCommands } from '../src/protocol';

const FRAME_BYTES = 128 * 128 * 2;
const stream = (animation: Animation) => Buffer.concat(uploadCommands(animation).chunks);
const solid = (count: number, ms = 100) =>
  Array.from({ length: count }, (_, index) => ({ frame: new Frame(rgb(index, 0, 0)), ms }));

test.each([
  ['a still image', Animation.still(new Frame()), 9, [0x01, 0xff]],
  ['five frames at 500ms', Animation.of(solid(5, 500)), 41, [0x05, 0xfa, 0xfa, 0xfa, 0xfa, 0xfa]],
  ['the longest animation', Animation.of(solid(255)), 2041, [0xff, 0x32, 0x32]],
])('%s fills whole chunks, led by the frame count and delays', (_, animation, chunks, header) => {
  const data = uploadCommands(animation).chunks;
  expect(data).toHaveLength(chunks);
  expect(data.every((chunk) => chunk.length === 4096)).toBe(true);
  expect([...stream(animation).subarray(0, header.length)]).toEqual(header);
});

test('each frame starts 256 + n * 32768 bytes in, and the tail is zero padding', () => {
  const frames = solid(3).map(({ frame }, index) => ({
    frame: frame.rect(0, 0, 1, 1, rgb(0, 0, 8 * (index + 1))),
    ms: 100,
  }));
  const bytes = stream(Animation.of(frames));
  frames.forEach((_, index) => expect(bytes[256 + index * FRAME_BYTES]).toBe(index + 1));
  expect(bytes.subarray(256 + 3 * FRAME_BYTES).every((byte) => byte === 0)).toBe(true);
});

test.each([
  ['red', rgb(255, 0, 0), [0, 0, 0x00, 0xf8]],
  ['green', rgb(0, 255, 0), [0, 0, 0xe0, 0x07]],
  ['blue', rgb(0, 0, 255), [0, 0, 0x1f, 0x00]],
])('%s is little-endian RGB565, row-major from the top-left', (_, fill, bytes) => {
  const right = stream(Animation.still(new Frame().rect(1, 0, 1, 1, fill)));
  const below = stream(Animation.still(new Frame().rect(0, 1, 1, 1, fill)));
  expect([...right.subarray(256, 260)]).toEqual(bytes);
  expect([...below.subarray(256 + 256, 256 + 258)]).toEqual(bytes.slice(2));
});

test.each([
  ['no frames', []],
  ['too many frames', solid(256)],
  ['a frame shorter than one tick', solid(1, 1)],
  ['a frame longer than the delay byte holds', solid(1, 511)],
  ['a frame of no length', solid(1, Number.NaN)],
  ['a hole where a frame should be', Object.assign<{ frame: Frame; ms: number }[], object>([], { length: 1 })],
])('an animation with %s is refused', (_, frames) => {
  expect(() => Animation.of(frames)).toThrow();
});

test('an animation keeps the pixels it was built from', () => {
  const frame = new Frame(rgb(255, 0, 0));
  const animation = Animation.still(frame);
  frame.rect(0, 0, 1, 1, rgb(0, 0, 255));
  expect([...stream(animation).subarray(256, 258)]).toEqual([0x00, 0xf8]);
});

test.each([
  ['a value above a byte', [0x104, 0x113]],
  ['a negative value', [-1]],
  ['a fraction', [4.5]],
  ['NaN', [Number.NaN]],
  ['more than 64 bytes', Array.from({ length: 65 }, () => 0)],
])('a command with %s is refused rather than wrapped into another', (_, bytes) => {
  expect(() => packet(bytes)).toThrow(RangeError);
});

test('the clock refuses an invalid date', () => {
  expect(() => clockCommands(new Date(Number.NaN))).toThrow(RangeError);
});

test('the upload header names slot 1 and the chunk count little-endian', () => {
  expect(
    uploadCommands(Animation.of(solid(100)))
      .header.subarray(0, 10)
      .toHex(),
  ).toBe('04720100000000002103');
});

test('the clock payload matches what the keyboard echoed on hardware', () => {
  const { header, payload } = clockCommands(new Date(2026, 9, 12, 16, 52, 58));
  expect(header.subarray(0, 9).toHex()).toBe('042800000000000001');
  expect(payload.subarray(0, 11).toHex()).toBe('00015a1a0a0c10343a0001');
  expect(payload.subarray(62).toHex()).toBe('aa55');
});

test.each([
  ['an accepted reply', '04180001', true],
  ['a reply for another command', '04020001', false],
  ['a commit with nothing pending', '041800ff', false],
  ['an incomplete upload', '04180000', false],
])('%s is told apart', (_, reply, ok) => {
  expect(accepted(packet([0x04, 0x18]), packet(Uint8Array.fromHex(reply)))).toBe(ok);
});

test.each([
  ['a chunk acknowledgement', '015a0200000000', true],
  ['an empty report', '', false],
  ['anything else', '015a0300', false],
])('%s is told apart from an acknowledgement', (_, report, ok) => {
  expect(acknowledged(Uint8Array.fromHex(report))).toBe(ok);
});
