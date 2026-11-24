# Changelog

Releases of `@blockbrawl-game/community-kit`. Each is a git tag `vX.Y.Z` with the packed kit attached to its
GitHub release; install it from
`https://github.com/blockbrawl-game/community-kit/releases/download/vX.Y.Z/blockbrawl-game-community-kit-X.Y.Z.tgz`.

## Versioning

There are two version numbers, and they mean different things.

- **The SDK line** (`"sdk": "0.1"` in `mode.json`) is the contract between a mode and the game server: the
  `defineMode` and `connect` interfaces, the runtime and the step protocol. A mode written for SDK `0.1` runs on
  every server and kit that supports `0.1`. A new line (`0.2`) is a breaking change; servers say which lines they
  run.
- **The kit version** (this changelog, `package.json`) is the version of this package: the CLI, the checks, the
  templates, the docs, the bundler.
  - **Patch** (`0.6.1`): fixes and docs. Build output is unchanged.
  - **Minor** (`0.7.0`): new commands, checks or limits within the same SDK line. A mode that passed `check`
    may need changes to pass again; the entry says which.
  - **Major** (`1.0.0`): a new SDK line, or anything that breaks existing modes.

**Hashes.** The server approves a mode by the sha256 of its built server bundle and client. Anything that changes
build output (the bundler, its options, the `sdk/` files) changes every hash, and approved modes must be
re-approved with the new kit. Every entry below says whether build output changed.

**Work units.** `bench` numbers are part of the contract too: an entry says when they change.

## Unreleased

Towards the unified runner (one tick for every mode, cheaper calls, per-player costs).

- **Prelude wire format v3** (`runtime/prelude.js`, `devkit/wire.js`). Calls take plain arguments
  (`tick(t)`, `action(playerIndex, actionText, t)`, `status(playerIndex, status, t)`, `sync(playerIndex)`) and
  return length-framed records instead of JSON. A call that does nothing returns the empty string. The prelude
  captures the built-ins it uses before a mode runs, so a mode that replaces `JSON` or array methods can no longer
  forge what the host reads, and it parses the action text itself (invalid JSON is rejected as `invalid_action`), so
  a client cannot splice anything into the call. The server (BlockBrawl) reads the same format.
- `WeakRef` and `FinalizationRegistry` are removed in the runtime and refused by the source policy: they expose
  garbage collection timing.
- `bench` reports `perPlayer`: units, batches and bytes per player-second; the baseline includes them.
- The output hash now skips calls that return nothing, on both hosts.
- **One clock for every mode; `tickRate` is gone.** Every match runs on a 50 ms grid (`devkit/clock.js`, the
  server's `MatchClock`). A mode with `onTick` is ticked on every slot while it is awake, and `dtMs` is the time
  since its previous `onTick`. `mode.json` no longer has `tickRate` (the key now fails `check`), and
  `maxTickRate` left `runtime/limits.json`.
- **`ctx.sleepUntil(t)` and `ctx.sleep()`**: skip ticks until match time `t`, or until the next action or status
  change. An action or status change wakes the mode unless that call sleeps again; a rejected action changes
  nothing. The prelude reports the wake time in a new `W` record and keeps it in the exported state. A sleeping
  mode costs the server nothing: duel-lite is now ticked about once per turn instead of twice a second.
- A late tick runs once on the latest slot (at most four slots late; the rest is dropped). Actions keep their exact
  time between ticks, and a tick that is due runs first, in `dev` as on the server (`MatchHost.advanceTo`).
  `MatchHost.tick(atTimeMs)` replays a tick at its recorded slot; journal tick entries no longer carry `dtMs`.
- The examples and templates move by time, not by counting ticks: duel-lite and bloom-blocks sleep until their turn
  deadlines, stack-race and trail-clash keep gravity and movement in milliseconds (`speed` steps now carry
  milliseconds) and sleep until the next fall or move (2 and 7 calls a second instead of 20), and the realtime
  template sleeps while nobody moves. tile-frenzy stays awake: something changes on every slot.
- The fuzz loop advances 100 ms per iteration, slot by slot, with actions between slots. `bench` measures per second
  of match time rather than per second of ticks.

- **The outbox** (`devkit/outbox.js`, the server's `MatchOutbox`). Each player's steps wait and are sent merged, one
  batch per player per flush, numbered when sent: the actor's acknowledgement goes out at once (after that player's
  pending steps), a rejection, sync, result or abort flushes what it concerns first, and the rest goes out at the
  end of the next tick, or at once when no tick is due within the next slot. Merged batches stay within the batch
  limit. tile-frenzy at 8 players: 19 batches per player-second instead of 27. On the server, each flush is one
  stream message, and players with the same steps share one entry in it.
- The batch limit is now on a call's steps for one player (16 KB minus 128 bytes for the envelope), on both hosts.
- Recordings are format 2 and carry `expect.wireHash`: what every player was sent, in order, which the server's
  parity tests compare. `test` checks that it survives sandbox restarts too.

This is not backward compatible and was not meant to be: SDK `0.1` has not shipped to creators yet, so it changes in
place.

Build output: the bundler and the `sdk/` runtime files are unchanged, but every example's source changed, so their
hashes changed. Work units: changed for every mode; the bench baseline and the parity recordings were regenerated.

## 0.7.0

Submitting modes to the game: the mode registry.

- **`brawl-modes publish <mode>`**: runs `check`, packs the mode's source (not `dist/`, `node_modules/` or hidden
  files) as a reproducible `.tar.gz` and uploads it to the game's registry with the creator token in
  `BRAWL_MODES_TOKEN`. `--server` or `BRAWL_MODES_SERVER` picks another server; `--skip-check` uploads without
  checking first.
- **`brawl-modes status [<submission> | <mode>] [--wait]`**: a submission's state and reasons, a mode's recent
  submissions, or your modes and their live versions.
- **`docs/publishing.md`**: tokens, the states of a submission, what the server does, and the rules (versions,
  ownership, 10 submissions an hour). The agent guide lists the new commands and says to publish only when asked.

Build output: unchanged. Work units: unchanged.

## 0.6.0

Agent-first developer support.

- **`brawl-modes new <id> [--template turn|realtime|offline] [--name "Name"]`** (also `--offline`): creates
  `modes/<id>` from a template that passes `check` as generated. In a new workspace it also writes `AGENTS.md`,
  `CLAUDE.md`, `jsconfig.json`, `.gitignore` and, if missing, `package.json`. It never overwrites a file.
- **`AGENTS.md` and `CLAUDE.md`**: instructions for AI assistants, at the root, in `modes/` and in every new
  workspace: the commands, what "done" means, the rules that fail review and how to read every failure.
- **`schema/mode.schema.json`** for `mode.json`, referenced from `$schema` in new modes.
- **Editor types**: `sdk/server.d.ts`, `sdk/client.d.ts`, `sdk/offline.d.ts` (with `OfflineGame`), so
  `jsconfig.json` with `checkJs` gives completion and checking in plain JavaScript.
- **Stricter `mode.json` checks**, matching the schema: unknown keys fail (most are typos), `orientation` must
  be `portrait`, `landscape` or `any`, an offline mode must not have `clientModel` or `fuzz`, and a thumbnail
  over 512 KB fails. A mode with any of these needs a fix to pass `check`.
- **Docs**: `getting-started.md`, `offline-modes.md`, `listing.md`, the source policy in `limits.md`, a README per
  example, this changelog. `interfaces.md` and `limits.md` no longer say `Math.random` is safe to use: the
  policy has always rejected it in online modes.
- **CLI**: help names the tool `brawl-modes` and describes every command; `--json`, `--offline`, `--remote` and
  `--help` never take a value.
- Issue templates for a mode idea and a question.

Build output: unchanged (every example's hashes are the same as in 0.5.0). Work units: unchanged.

## 0.5.0

- **`brawl-modes bench <mode>`**: server cost in work units, identical on every machine, against two gates in
  `runtime/limits.json` (`maxWorkPerCall` 1,000,000, `maxWorkPerSecond` 500,000; `workPerByte` 10). See
  `docs/benchmark.md`.
- **`brawl-modes check <mode>`**: source policy, `test`, `bench` and build hashes with one verdict and `--json`.
- CI requires the example modes to reproduce `scripts/bench-baseline.json` exactly.

Build output: unchanged.

## 0.4.2

- `@microsoft/signalr` 11.0.0 (the play shell's transport).

## 0.4.1

- esbuild 0.28.2.

## 0.4.0

- The first public release: the SDK, the dev kit (`dev`, `test`, `build`), the runtime prelude and limits, the play
  shell and the example modes, under the MIT license.
