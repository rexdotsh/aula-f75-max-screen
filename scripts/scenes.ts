import { Animation, Frame, HEIGHT, WIDTH, rgb, textWidth, type Color } from '../src';

const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);

function testCard(): Frame {
  const frame = new Frame(BLACK)
    .rect(0, 0, WIDTH, 1, WHITE)
    .rect(0, HEIGHT - 1, WIDTH, 1, WHITE)
    .rect(0, 0, 1, HEIGHT, WHITE)
    .rect(WIDTH - 1, 0, 1, HEIGHT, WHITE)
    .text('TL', 3, 3, WHITE)
    .text('TR', WIDTH - 3 - textWidth('TR'), 3, WHITE)
    .text('BL', 3, HEIGHT - 10, WHITE)
    .text('BR', WIDTH - 3 - textWidth('BR'), HEIGHT - 10, WHITE)
    .centerText('F75', 48, rgb(255, 200, 0), 3);
  const bars = [
    ['R', rgb(255, 0, 0), WHITE],
    ['G', rgb(0, 255, 0), WHITE],
    ['B', rgb(0, 0, 255), WHITE],
    ['W', WHITE, BLACK],
  ] as const;
  bars.forEach(([name, fill, ink], index) =>
    frame.rect(6 + index * 30, 14, 26, 26, fill).text(name, 16 + index * 30, 23, ink),
  );
  const ramps = [
    (v: number) => rgb(v, v, v),
    (v: number) => rgb(v, 0, 0),
    (v: number) => rgb(0, v, 0),
    (v: number) => rgb(0, 0, v),
  ];
  ramps.forEach((ramp, index) => {
    for (let x = 6; x < WIDTH - 6; x++) frame.rect(x, 76 + index * 9, 1, 7, ramp(((x - 6) / (WIDTH - 13)) * 255));
  });
  return frame;
}

/** White text on `background`, scaled as large as the longest line allows. */
function label(text: string, background: Color): Frame {
  const frame = new Frame(background);
  const lines = text.split('\n');
  const widest = Math.max(1, ...lines.map((line) => textWidth(line)));
  const scale = Math.max(1, Math.min(8, Math.floor((WIDTH - 8) / widest)));
  const lineHeight = 9 * scale;
  const top = (HEIGHT - lines.length * lineHeight + 2 * scale) / 2;
  lines.forEach((line, index) => frame.centerText(line, top + index * lineHeight, WHITE, scale));
  return frame;
}

export const pattern = () => Animation.still(testCard());

export const text = (value: string, background: Color) => Animation.still(label(value, background));

export function counter(ms: number): Animation {
  return Animation.of(
    [1, 2, 3, 4, 5].map((n) => ({ frame: label(String(n), n % 2 ? rgb(32, 32, 96) : rgb(96, 32, 32)), ms })),
  );
}

export function sweep(ms: number): Animation {
  return Animation.of(
    Array.from({ length: 8 }, (_, index) => ({ frame: new Frame(BLACK).rect(index * 16, 0, 16, HEIGHT, WHITE), ms })),
  );
}

export function numbered(count: number): Animation {
  return Animation.of(
    Array.from({ length: count }, (_, index) => ({
      frame: label(String(index + 1), rgb((index / count) * 200, 40, 120)).rect(
        0,
        HEIGHT - 8,
        ((index + 1) / count) * WIDTH,
        8,
        WHITE,
      ),
      ms: 100,
    })),
  );
}
