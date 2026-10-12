import { ADVANCE, GLYPH_HEIGHT, glyph } from './font';

export const WIDTH = 128;
export const HEIGHT = 128;

declare const rgb565: unique symbol;

/** A pixel in the screen's native RGB565, made by `rgb` or `color`. */
export type Color = number & { readonly [rgb565]: true };

const channel = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

export function rgb(r: number, g: number, b: number): Color {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one place a Color is minted
  return (((channel(r) >> 3) << 11) | ((channel(g) >> 2) << 5) | (channel(b) >> 3)) as Color;
}

/** The 8-bit channels a stored RGB565 pixel shows as. */
export function channels(pixel: number): [r: number, g: number, b: number] {
  const r = pixel >> 11;
  const g = (pixel >> 5) & 0x3f;
  const b = pixel & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

export function color(hex: string): Color {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!digits) throw new RangeError(`not a #rrggbb color: ${hex}`);
  const value = Number.parseInt(digits, 16);
  return rgb(value >> 16, (value >> 8) & 0xff, value & 0xff);
}

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));

export function textWidth(text: string, scale = 1): number {
  return Math.max(0, text.length * ADVANCE - 1) * scale;
}

/** One 128x128 screen image, row-major from the top-left. */
export class Frame {
  readonly pixels = new Uint16Array(WIDTH * HEIGHT);

  constructor(background: Color = rgb(0, 0, 0)) {
    this.pixels.fill(background);
  }

  rect(x: number, y: number, width: number, height: number, fill: Color): this {
    const left = clamp(x, WIDTH);
    const right = clamp(x + width, WIDTH);
    for (let row = clamp(y, HEIGHT); row < clamp(y + height, HEIGHT); row++) {
      this.pixels.fill(fill, row * WIDTH + left, row * WIDTH + right);
    }
    return this;
  }

  text(text: string, x: number, y: number, fill: Color, scale = 1): this {
    for (let index = 0; index < text.length; index++) {
      for (const [column, bits] of glyph(text.charAt(index)).entries()) {
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
          if (bits & (1 << row)) this.rect(x + (index * ADVANCE + column) * scale, y + row * scale, scale, scale, fill);
        }
      }
    }
    return this;
  }

  centerText(text: string, y: number, fill: Color, scale = 1): this {
    return this.text(text, (WIDTH - textWidth(text, scale)) / 2, y, fill, scale);
  }
}
