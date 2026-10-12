# AGENTS.md

A TypeScript library and CLI that drive the 128x128 screen on the Aula F75 Max keyboard over USB HID. It is the base for status indicators (an opencode plugin first), so it has to be dependable when called from long-running processes.

## Commands

Bun is the only package manager and script runner. Never use npm, pnpm or yarn. Formatting is oxfmt and linting is oxlint; do not add Prettier, ESLint or editor config files.

| Task                     | Command                                  |
| ------------------------ | ---------------------------------------- |
| Install                  | `bun install`                            |
| Format                   | `bun run fmt`                            |
| Lint (type-aware oxlint) | `bun run lint`                           |
| Unused code and deps     | `bun run knip`                           |
| Typecheck (tsgo)         | `bun run check`                          |
| Test                     | `bun run test`                           |
| Drive the screen         | `bun run screen <command>`               |
| Preview without hardware | `bun run screen preview out.png <scene>` |

`bun run fmt:check`, `bun run lint`, `bun run knip`, `bun run check` and `bun run test` must all pass before every push. CI runs the same steps.

## Layout

```
src/protocol.ts  wire format: ids, packets, stream encoding. Pure, no I/O
src/keyboard.ts  the HID transport: open, upload, clock, key lighting, raw exchange
src/keys.ts      each key's light index
src/frame.ts     128x128 RGB565 canvas with rects and text
src/font.ts      5x7 bitmap font
src/index.ts     public API
scripts          the screen CLI, its test scenes and PNG previews
test             bun tests
docs             PROTOCOL.md (what is known about the device) and findings/ (raw hardware sessions)
```

## Architecture invariants

- Every fact about the device's wire format lives in `src/protocol.ts` and is documented in `docs/PROTOCOL.md`, marked confirmed (seen on our hardware) or reported (from prior work). Nothing else builds packets or splits streams; `Keyboard` only moves the bytes `protocol.ts` hands it.
- Input is validated once, when it is built: an `Animation` can only exist within the device's limits, a `Color` only comes from `rgb` or `color`. Nothing downstream re-checks.
- The screen is reachable only over USB. `Keyboard.open()` resolves to `undefined` when the keyboard is not plugged in; that is an expected state, not an error.
- One `Keyboard` serialises its own operations, so callers may fire uploads concurrently without interleaving packets on the wire. Once `close()` is called, later calls reject.
- Every reply is checked: the op echo and accepted status of each command, the echo of each payload, the prefix of each chunk acknowledgement. A mismatch, or any HID failure, throws `KeyboardError`. Never retry or skip silently.
- A failed transfer breaks the connection: a late reply could pair with the next command, so that `Keyboard` refuses all further work, including work already queued, until it is closed and reopened. Inputs are validated before they are queued, so only transfers can fail inside the queue.
- An `Animation` snapshots its pixels when built and is encoded only when its upload runs.
- node-hid feature reports have no timeout, so a wedged device blocks that `Keyboard`'s queue until it is unplugged.
- The CLI rejects arguments it does not use, so a mistyped flag can never turn into a device command.
- Frames are RGB565 from the moment they are drawn; there is no second pixel format.
- The keyboard always displays the newest upload and shows its own progress screen during every upload. Callers decide when an upload is worth that.

## Hardware work

- Probe changes against real hardware and record each session in `docs/findings/` (date, method, every observation and measurement), then fold confirmed facts into `docs/PROTOCOL.md`.
- Unknown commands go through `bun run screen send <hex>` or `Keyboard.exchange`, never through ad-hoc scripts that build their own packets.
- Do not send factory reset or keymap/lighting write sequences while probing.

## Privacy

This repository is public. It must never contain anything that identifies a person or a machine: no names, serial numbers, device instance paths, usernames or home directory paths.

## Code standards

The bar is the [thermo-nuclear code quality review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md). In short:

- **Comments are rare.** Write code that does not need them. Only comment a non-obvious _why_ (a device quirk, a protocol requirement). Never narrate what the next line does, never leave section banners, TODOs without an issue, or commented-out code.
- **No duplication.** Before writing a helper, search for an existing one. Two copies of the same logic is a bug.
- **Direct and boring.** No speculative abstraction, no pass-through wrappers, no clever indirection. Delete layers rather than polish them. Look for the restructure that makes branches disappear.
- **Types are the contract.** No `any`. Avoid `unknown` except at a validated boundary, avoid casts, avoid optionality that hides an invariant. Validate untrusted input once, at the edge, into a typed value.
- **No spaghetti.** Do not bolt special-case `if`s onto unrelated flows. Model the difference (a table, a union, a dedicated module) instead.
- **Small focused files.** Treat 300 lines as a prompt to split, and never let a file pass 1000 lines.
- **Parallel and atomic.** Run independent async work concurrently. Keep related writes in one transaction so state is never half-applied.
- **Fail loudly.** No silent catch-and-continue. Expected failures are typed results. Unexpected ones surface.
- **Few dependencies.** Prefer platform and Bun APIs. Every new dependency needs a reason in the PR description.

## Testing

A test exists to catch a bug that would hurt someone. CI has no keyboard, so the wire format is the one thing only a test can guard: a wrong byte garbles the screen or confuses the firmware.

- **Write one for:** stream encoding, packet layouts and validation limits, pinned to values confirmed on hardware.
- **Never write one that:** pins a scene's look, restates the code, covers what types or lint guarantee, or needs a keyboard attached.
- **Prefer one table-driven test over many small ones.** A test file longer than the code it covers is a smell.

## Workflow

- Small changes go straight to `main`: docs, findings, config, and small fixes. Every check must still pass before pushing.
- Big changes (a new feature, a new device capability, a restructure, or anything touching the wire format or transport) go on a branch as a PR, are reviewed by an independent agent against the code standards above, and are squash-merged once the reviewer has no remaining structural objections.
- Conventional Commits for every commit and PR title (`feat(protocol): …`, `fix(keyboard): …`, `docs: …`).
- A PR is one feature or concern. Its description says what changed, why, and how it was verified (on hardware when it touches the device).
