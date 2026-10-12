# Vendor driver decompilation, 2026-10-12

Source: Epomaker's `AULA_F75_Max_Gasket_Mechanical_Keyboard_Driver_1.0.0.5.zip`, an Inno Setup 6.1 installer, unpacked with `innoextract` (never run). The app is `DeviceDriver.exe`, 32-bit MFC, decompiled headless with Ghidra 12.1.4. Addresses below are function entry points in that binary.

## Files

- `config.xml`: wired mode `0c45:800a` on `MI_00`, 2.4G mode `05ac:024f` on `MI_03`.
- `layouts/rgb-keyboard.xml`: `<screen gif_headlength="256" gif_maxframes="255" gif_count="1" width="128" height="128"/>`, `<cmd_delaytime value="35"/>`, and every key with its HID usage `code` and `key_index` (Page Up `0x4b` at 118, Home `0x4a`, End `0x4d` at 120, Page Down `0x4e` at 121).
- `language/1033.lan`: the TFT tab offers New, Import GIF, frame editing, Upload to keyboard, Delete LED and Time Sync. Nothing switches screen pages.

## Transport

- `FUN_0044eeb0` sends a buffer as 64-byte feature reports (report ID `00`), sleeping `cmd_delaytime` (35ms) before each, and reads a feature reply after each when asked to. Longer buffers go out as consecutive 64-byte reports.
- `FUN_0044f2b0` writes 4096-byte output reports to the display interface.
- `FUN_0044f380` sends a command, then reads 64-byte reports back until the requested count arrives: the read path.
- `FUN_0044f5d0` drives the 2.4G receiver with its own framing; not covered here.

## Commands found

Every `04 xx` the binary builds, by call site:

| Op   | Function                                                       | What it does                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `18` | many                                                           | begin a transaction                                                                                                                                                                                        |
| `02` | many                                                           | commit                                                                                                                                                                                                     |
| `f0` | `FUN_004183d0`, `FUN_0042b0d0`, `FUN_0044b8f0`, `FUN_0044ba00` | sent after commit on key map, lighting and colour profile writes; saves to flash                                                                                                                           |
| `72` | `FUN_00422930`                                                 | display upload header: `[2]` the selected item in the app's GIF list + 1, `[8..9]` chunk count                                                                                                             |
| `28` | `FUN_004238f0`                                                 | clock header, `[8] = 01`                                                                                                                                                                                   |
| `17` | `FUN_00414020`                                                 | settings header `[2] = 01, [8] = 01`; payload `00 01 a b c fn sleep 00 response … aa 55` where `a b c` are three checkboxes, `fn` is `fn_switch`, `sleep` is `sleep_time`, `response` is `key_respondtime` |
| `11` | `FUN_004183d0`                                                 | base layer key map write, `[8] = 09`, then 576 bytes                                                                                                                                                       |
| `27` | `FUN_004183d0`                                                 | Fn layer key map write, same layout                                                                                                                                                                        |
| `13` | `FUN_0042b0d0`, `FUN_0044b8f0`                                 | lighting mode write, `[8] = 01`; payload `mode r g b … [8] [9] [10] [11]`, `aa 55` at 14-15                                                                                                                |
| `19` | `FUN_0042d6d0`                                                 | begin a macro transaction (instead of `18`)                                                                                                                                                                |
| `15` | `FUN_0042d6d0`                                                 | macro data header, `[8]` = packet count, payload ends `aa 55`                                                                                                                                              |
| `20` | `FUN_00427dc0`, `FUN_004329c0`                                 | real-time per-key colour stream, `[8]` = 3 or 8 packets, no begin                                                                                                                                          |
| `23` | `FUN_0044ba00`                                                 | per-key colour profile write, `[8]` = 3 or 9 packets, 4 bytes per key `index r g b`, `aa 55`                                                                                                               |
| `f5` | `FUN_0042aeb0`                                                 | per-key colour read, `[8]` = 3 or 9 packets read back                                                                                                                                                      |

## Corrections to prior work

The VitalyArt driver's factory reset labels four steps by guess; the code says otherwise:

- `04 19` + `04 15` is the macro store, not "display memory".
- `04 17` is the settings block (sleep, response time, Fn switch), not "display config".
- `04 27` is the Fn layer key map, not lighting data.
- `04 13` is the lighting mode, not a "reset footer"; the reset's payload `0b ff … 01 05 03 … aa 55` is mode 11 at brightness 5, speed 3, the documented defaults.

## The screen

- There is one animation slot (`gif_count="1"`). The upload's slot byte is just the app's list index; the firmware keeps the newest upload.
- The app fills its stream buffer with `ff`, so its header tail and padding are `ff`; this library zero-pads, confirmed working on hardware.
- Delay bytes are the frame's milliseconds halved, at least 1.
- No command switches pages or suppresses the progress screen. The only screen operations the vendor uses are the upload and the clock sync.

## Key map entries

`FUN_004183d0` fills a 576-byte table (9 packets), 4 bytes per key at `key_index * 4`, with `aa 55` at bytes 574-575. Only remapped keys are written; every other entry is zero, the firmware default. Entry types:

| Bytes              | Meaning                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `00 00 00 00`      | default                                                                                                          |
| `02 mods usage 00` | keyboard key: modifier bits and HID usage (a bare modifier key is `02 usage 00 00`)                              |
| `01 btn …`         | mouse button                                                                                                     |
| `03 usage …`       | consumer key (`cd` play/pause, `b5` next, `b6` previous, `b7` stop, `e9` volume up, `ea` volume down, `e2` mute) |
| `06 macro …`       | macro by index                                                                                                   |
| `05 03 …`          | disabled                                                                                                         |

So remapping Page Up to Home is `02 00 4a 00` at offset 472 of the base layer map, and an all-zero map restores every key.
