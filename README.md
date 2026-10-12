# aula-f75-max-screen

Drive the 128x128 screen on the Aula F75 Max keyboard from TypeScript.

The screen is only reachable with the keyboard plugged in over USB. Images are stored on the keyboard, so they stay up after unplugging and in wireless mode.

```ts
import { Animation, Frame, Keyboard, color } from 'aula-f75-max-screen';

const keyboard = await Keyboard.open();
if (keyboard) {
  await keyboard.upload(Animation.still(new Frame(color('#0050a0')).centerText('BUSY', 56, color('#ffffff'), 3)));
  await keyboard.close();
}
```

`Animation.of([{ frame, ms }, …])` builds an animation of up to 255 frames of 2-510ms each, and refuses anything else. Every upload shows the keyboard's own progress screen first: about 1.5s for a still image, about 1.2s per extra frame.

## CLI

```sh
bun install
bun run screen pattern                   # orientation and color test card
bun run screen label 'HI\nTHERE' '#003366'
bun run screen counter 500               # five frames, 500ms each
bun run screen clock                     # sync the keyboard clock
bun run screen send 0402                 # raw command, prints the reply
bun run screen preview out.png pattern   # render without a keyboard
```

## Protocol

Everything known about the device is in [docs/PROTOCOL.md](docs/PROTOCOL.md), with raw hardware sessions in [docs/findings](docs/findings).
