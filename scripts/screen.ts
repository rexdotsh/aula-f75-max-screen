import { Keyboard, color, type Animation } from '../src';
import { png } from './png';
import { counter, numbered, pattern, sweep, text } from './scenes';

const USAGE = `usage: bun run screen <command>

scenes, uploaded to the keyboard:
  pattern                  orientation and color test card
  label [text] [#rrggbb]   white text on a solid color, \\n for a new line
  counter [ms]             five numbered frames
  sweep [ms]               a bar sweeping left to right
  frames [count]           numbered frames with a progress bar

  preview <file.png> <scene> [args]   render a scene to a PNG instead, no keyboard needed

device:
  clock                    sync the keyboard clock
  send <hex>               send one raw command, zero padded to 64 bytes, and print the reply`;

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new RangeError(`not a whole number: ${value}`);
  return parsed;
}

interface Command<T> {
  /** Fewest and most arguments accepted; anything else is a usage error, never silently dropped. */
  arity: readonly [min: number, max: number];
  run: (args: string[]) => T;
}

const SCENES = new Map<string, Command<Animation>>([
  ['pattern', { arity: [0, 0], run: () => pattern() }],
  [
    'label',
    {
      arity: [0, 2],
      run: ([value = 'HELLO', background = '#000000']) => text(value.replaceAll('\\n', '\n'), color(background)),
    },
  ],
  ['counter', { arity: [0, 1], run: ([ms]) => counter(int(ms, 500)) }],
  ['sweep', { arity: [0, 1], run: ([ms]) => sweep(int(ms, 20)) }],
  ['frames', { arity: [0, 1], run: ([count]) => numbered(int(count, 20)) }],
]);

async function withKeyboard(work: (keyboard: Keyboard) => Promise<void>): Promise<void> {
  const keyboard = await Keyboard.open();
  if (!keyboard) throw new Error('keyboard not found: the screen is only reachable over USB');
  try {
    await work(keyboard);
  } finally {
    await keyboard.close();
  }
}

const DEVICE = new Map<string, Command<Promise<void>>>([
  ['clock', { arity: [0, 0], run: () => withKeyboard((keyboard) => keyboard.syncClock()) }],
  [
    'send',
    {
      arity: [1, 1],
      run: ([hex = '']) =>
        withKeyboard(async (keyboard) => {
          process.stdout.write(`${(await keyboard.exchange(Uint8Array.fromHex(hex))).toHex()}\n`);
        }),
    },
  ],
]);

async function upload(animation: Animation): Promise<void> {
  const started = performance.now();
  await withKeyboard((keyboard) =>
    keyboard.upload(animation, (sent, total) => process.stderr.write(`\rchunk ${sent}/${total}`)),
  );
  console.error(`\nuploaded ${animation.frames.length} frame(s) in ${Math.round(performance.now() - started)}ms`);
}

async function preview(file: string, animation: Animation): Promise<void> {
  await Bun.write(file, png(animation.frames));
  console.error(`wrote ${file}`);
}

function bind<T>(command: Command<T> | undefined, args: string[]): (() => T) | undefined {
  if (!command) return undefined;
  const [min, max] = command.arity;
  return args.length >= min && args.length <= max ? () => command.run(args) : undefined;
}

function resolve([name = '', ...args]: string[]): (() => Promise<void>) | undefined {
  if (name === 'preview') {
    const [file, scene = '', ...rest] = args;
    const build = bind(SCENES.get(scene), rest);
    return file && build ? () => preview(file, build()) : undefined;
  }
  const build = bind(SCENES.get(name), args);
  return build ? () => upload(build()) : bind(DEVICE.get(name), args);
}

const command = resolve(process.argv.slice(2));
if (!command) {
  console.error(USAGE);
  process.exit(1);
}
await command();
