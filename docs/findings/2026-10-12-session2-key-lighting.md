# Per-key lighting, 2026-10-12

Wired, Windows 11, driven with `Keyboard.exchange`. The user watched the keys.

## Live stream (`04 20`)

`04 20 … [8] = 08`, then 512 bytes as 8 packets (Esc = `01 ff 00 00` at offset 4), then `04 02`. Every packet was accepted (header and commit status `01`, data echoed), but the keys did not change, both in the stock effect and in the user-defined mode. The vendor streams this from its real-time and music tabs; whatever else those tabs set up is still unknown.

## User-defined mode (`04 13`, mode `80`)

`04 18`, `04 13 … [8] = 01`, payload `80 00 … [9] = 04 … aa 55` (at 14-15), `04 02`, without the `04 f0` save. All accepted; the commit replied `04 02 00 01 83 01`. The keys went dark: the user-defined mode shows the per-key profile, which was empty.

## Per-key profile (`04 23`)

`04 18`, `04 23 … [8] = 09`, 576 bytes as 9 packets (Esc = `01 ff 00 00` at offset 4, `aa 55` at 574-575), `04 02`, without `04 f0`. **Esc lit red.** Writing Esc off and red alternately blinked it cleanly. Each write took about 72ms. The commit reply carried extra bytes (`… 01 ff 01` after a red write, `… 01 00 01` after an off write).

## Persistence

After unplugging for about 5s, the user-defined mode and the red Esc were still there. The keyboard has a battery and no power switch, so unplugging does not power it down: this does not tell RAM from flash, for the lighting or for screen uploads. Whether writes without `04 f0` reach flash, and so wear it, is open.
