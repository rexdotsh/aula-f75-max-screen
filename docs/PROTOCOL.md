# Aula F75 Max screen protocol

**Confirmed** means seen on our hardware (sessions in [findings](findings)). **Decompiled** means read from the vendor driver's code ([decompilation notes](findings/2026-10-12-vendor-decompile.md)) but not yet exercised here. **Reported** means taken from prior work and not yet checked either way.

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

A write is `begin`, a header naming how many 64-byte data packets follow (`[8]`), the packets, `commit`, and for settings kept in flash a final `save`. The vendor sleeps 35ms before every command; we have not needed to.

| Op   | Command                  | Arguments                                                                                           |                       |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------- |
| `18` | begin                    |                                                                                                     | confirmed             |
| `02` | commit                   |                                                                                                     | confirmed             |
| `72` | upload header            | `[2]` slot, `[8..9]` chunk count, u16 little-endian                                                 | confirmed             |
| `28` | clock header             | `[8] = 01`, then the clock payload                                                                  | confirmed             |
| `f0` | save                     | after commit, for key maps, lighting and colour profiles                                            | decompiled            |
| `17` | settings                 | `[2] = 01`, `[8] = 01`; payload `00 01 a b c fn sleep 00 response … aa 55`                          | decompiled            |
| `11` | base layer key map       | `[8] = 09`, then the 576-byte key map                                                               | decompiled            |
| `27` | Fn layer key map         | `[8] = 09`, then the 576-byte key map                                                               | decompiled            |
| `13` | lighting mode            | `[8] = 01`; payload `mode r g b …`, `aa 55` at 14-15; mode `80` is user-defined                     | confirmed (mode `80`) |
| `23` | per-key colour profile   | `[8] = 09`; 4 bytes per key at `light_index * 4`, `index r g b`, `aa 55` at 574-575                 | confirmed             |
| `f5` | per-key colour read      | `[8] = 09`; the keyboard sends the profile back                                                     | decompiled            |
| `20` | real-time per-key colour | `[8] = 08`, no begin; a live colour frame. Accepted but not shown in the stock or user-defined mode | open                  |
| `19` | begin macro write        | in place of `18`                                                                                    | decompiled            |
| `15` | macro data               | `[8]` = packet count, payload ends `aa 55`                                                          | decompiled            |

Prior work labelled `19`/`15` "display clear", `17` "display config", `27` "lighting" and `13` "reset footer"; the vendor code says otherwise.

### Per-key lighting (confirmed)

Switch to the user-defined mode (`04 13`, mode `80`), then each `04 23` write sets every key's colour, with keys indexed by `light_index` from the vendor's layout file (Esc is 1). Brightness `0` (byte 9 of the mode payload) turns every key off (confirmed). A write takes about 72ms and shows immediately, without `f0`; blinking a key by rewriting works cleanly. The keyboard runs on its battery when unplugged, so persistence across a replug does not show whether a write without `f0` reaches flash. See [session 2](findings/2026-10-12-session2-key-lighting.md).

### Key maps (decompiled)

576 bytes, 4 per key at `key_index * 4` (indices from the vendor's `layouts/rgb-keyboard.xml`), `aa 55` at bytes 574-575. A zero entry keeps the key's default, so an all-zero map resets the layer. `02 mods usage 00` sends a key with modifiers; other types cover mouse buttons (`01`), consumer keys (`03`), macros (`06`) and disabling (`05 03`). Page Up is index 118, so `02 00 4a 00` at offset 472 makes it Home.

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

A still image is one frame in 9 chunks. The vendor fills the unused header bytes and the padding with `ff` instead of zero (decompiled); both work.

### Behaviour (confirmed)

- The keyboard shows its own progress screen (1-100%) for the whole upload, then the new image about a second after commit. There is no silent update.
- A chunk takes about 145ms (the first about 220ms), so a still image takes about 1.5s and each further frame about 1.2s. 100 frames (801 chunks) took 115s.
- On Windows every open handle on the display interface receives every acknowledgement, whichever handle sent the chunk. Two programs uploading at once interleave chunks and leave the keyboard stuck on its progress screen until the next complete upload.
- Of each chunk's time, about 64ms is the write itself (4096 bytes at the interface's 64 bytes per millisecond) and about 78ms is the wait for the acknowledgement. Writing every chunk before reading any acknowledgement is not faster: the acknowledgements come slowly and the commit is refused (`ff`), so the keyboard needs each chunk acknowledged before the next. Image content does not matter; a still is always 9 chunks.
- Typing is unaffected during uploads.
- The newest upload is always the one displayed. The firmware has a single animation slot (`gif_count="1"` in the vendor's layout file); the vendor fills the slot byte with its own list index. Older uploads cannot be reached with the knob, and an upload header committed without data changes nothing.
- Uploads live in flash. They survive unplugging and show in wireless mode too.
- The full 128x128 is visible with nothing drawn over it. Animations loop, and 20ms frames play smoothly. 100-frame animations play in full.

## Screen pages (confirmed)

Spinning the knob cycles pages, pressing it opens a page's menu:

1. time, date and battery, shown after power-up
2. settings: system, effect, colour, brightness, speed, volume, language
3. the custom animation

A commit shows the custom animation page; a clock sync shows the clock page.

## Open questions

- The vendor driver has no command that switches pages, suppresses the progress screen or replaces part of an animation; the upload and the clock sync are its only screen operations. Whether the firmware has more is unknown, and finding out means probing unlisted ops on the device.
- Can the key maps, settings and lighting be read back like the colour profile (`f5`)?
- What limits animations besides the 255-frame header?

## Prior work

- [VitalyArt/Aula-F75-Max-Driver](https://github.com/VitalyArt/Aula-F75-Max-Driver): upload, clock, factory reset and wireless settings in Swift and Kotlin.
- [schiz0x00/keyboard-screen](https://github.com/schiz0x00/keyboard-screen): a Rust status screen; decompiled the vendor software to confirm the upload path and rule out wireless.
- [RoseWaveStudio/Aula-F75-Max-OSX](https://github.com/RoseWaveStudio/Aula-F75-Max-OSX)
