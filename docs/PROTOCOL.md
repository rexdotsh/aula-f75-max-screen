# Aula F75 Max screen protocol

**Confirmed** means seen on our hardware (sessions in [findings](findings)). **Reported** means taken from prior work and not yet checked here.

## Device

The keyboard enumerates as `0c45:800a` (SONiX, product string `AULA F75Max`). The screen is 128x128 RGB565.

| Interface | Usage page / usage                                                   | Input | Output | Feature | Role                                               |
| --------- | -------------------------------------------------------------------- | ----- | ------ | ------- | -------------------------------------------------- |
| MI_00     | `0x0001/0x06`                                                        | 9     | 2      |         | boot keyboard                                      |
| MI_01     | `0x000c`, `0x0001/0x80`, `0x0001/0x06`, `0x0001/0x02`, `0xffff/0x01` |       |        |         | media, system, NKRO keyboard, mouse, vendor        |
| MI_02     | `0xff68/0x61`                                                        | 65    | 4097   |         | **display**: pixel chunks out, acknowledgements in |
| MI_03     | `0xff13/0x01`                                                        | 65    | 65     | 65      | **command**: 64-byte feature reports               |

Report lengths include the report ID byte, which is always `00` on MI_02 and MI_03. Confirmed with `HidP_GetCaps` on Windows.

Only USB reaches the screen (reported): the 2.4G receiver (`05ac:024f`) has only 32-byte pipes, and the vendor software classifies HID interfaces by report length and never sends pixels to one without a 4097-byte output report.

## Commands

A command is a 64-byte feature report on MI_03, `04 <op>` followed by arguments, and its reply is read back with a feature `GET_REPORT`. Replies echo the op and carry a status at byte 3 (confirmed):

| Status | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| `01`   | accepted                                                                |
| `00`   | commit after an upload header whose data never arrived; nothing changes |
| `ff`   | commit with nothing pending                                             |

| Op   | Command             | Arguments                                                   |                         |
| ---- | ------------------- | ----------------------------------------------------------- | ----------------------- |
| `18` | begin               |                                                             | confirmed               |
| `72` | upload header       | `[2]` slot, `[8..9]` chunk count, u16 little-endian         | confirmed               |
| `28` | clock header        | `[8] = 01`, then the clock payload                          | confirmed               |
| `02` | commit              |                                                             | confirmed               |
| `19` | begin display clear |                                                             | reported, factory reset |
| `15` | clear display slots | `[8] = 08`, then 8 zero packets                             | reported, factory reset |
| `17` | display config      | `[2] = 01`, `[8] = 01`, then `00 01 00 00 00 00 02 00 02 …` | reported, factory reset |
| `11` | keymap write        | `[8] = 09`, then 9 packets                                  | reported                |
| `27` | lighting write      | `[8] = 09`, then 9 packets                                  | reported                |
| `13` | reset footer        | `[8] = 01`, then a payload                                  | reported                |
| `f0` | apply               |                                                             | reported                |

### Clock

`begin`, `clock header`, the payload, `commit` (confirmed). The payload is `00 01 5a 1a MM DD hh mm ss 00 WD`, zero padded, with `aa 55` at bytes 62-63; the weekday counts from Sunday = 0. The keyboard echoes the payload back. Syncing switches the screen to the clock page.

## Upload

`begin`, `upload header`, the stream as 4096-byte output reports on MI_02, `commit` (confirmed). The keyboard answers each chunk with one 64-byte input report starting `01 5a 02`, and sends nothing after the header. The screen only changes on commit.

The stream (confirmed):

| Bytes       | Content                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `0`         | frame count, 1-255                                                       |
| `1 … count` | one delay byte per frame, in 2ms ticks (1-255, so 2-510ms)               |
| up to `256` | zero                                                                     |
| `256 …`     | each frame as 128x128 RGB565, little-endian, row-major from the top-left |
| end         | zero padding to a whole chunk                                            |

A still image is one frame in 9 chunks.

### Behaviour (confirmed)

- The keyboard shows its own progress screen (1-100%) for the whole upload, then the new image about a second after commit. There is no silent update.
- A chunk takes about 145ms (the first about 220ms), so a still image takes about 1.5s and each further frame about 1.2s. 100 frames (801 chunks) took 115s.
- Typing is unaffected during uploads.
- The newest upload is always the one displayed. Slots do not form a library: older slots cannot be reached with the knob, and an upload header naming an older slot, committed without data, changes nothing.
- Uploads live in flash. They survive unplugging and show in wireless mode too.
- The full 128x128 is visible with nothing drawn over it. Animations loop, and 20ms frames play smoothly. 100-frame animations play in full.

## Screen pages (confirmed)

Spinning the knob cycles pages, pressing it opens a page's menu:

1. time, date and battery, shown after power-up
2. settings: system, effect, colour, brightness, speed, volume, language
3. the custom animation

A commit shows the custom animation page; a clock sync shows the clock page.

## Open questions

- Is there a command that switches pages, so an indicator could return to the custom animation (or leave it) without uploading?
- What does `04 17` hold, and can the display config be read back?
- Can the progress screen be suppressed, or a frame replaced without a full upload?
- What limits animations besides the 255-frame header: flash size, or slot size?

## Prior work

- [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver): upload, clock, factory reset and wireless settings in Swift and Kotlin.
- [schiz0x00/keyboard-screen](https://github.com/schiz0x00/keyboard-screen): a Rust status screen; decompiled the vendor software to confirm the upload path and rule out wireless.
- [RoseWaveStudio/Aula-F75-Max-OSX](https://github.com/RoseWaveStudio/Aula-F75-Max-OSX)
