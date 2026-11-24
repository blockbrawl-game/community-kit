# Building BlockBrawl community modes

Instructions for AI coding assistants (and people) working on community game modes for BlockBrawl. Each mode is
one folder, `modes/<id>/`. Read this file before you change anything.

## Done means `check` passes

```bash
npx brawl-modes check <id>
```

A mode is finished only when this prints `READY TO SUBMIT` (with `--json`, the last line on stdout is an object
with `"passed": true`). The review server runs exactly this command with exactly these numbers, so its verdict is
the review verdict for everything automatic. Run it after every change you consider finished, read every `FAIL`
line, fix the cause and run it again. Never report a mode as done, and never loosen a test, to get past a failure.

## Commands

| Command | What it does |
|---|---|
| `npx brawl-modes new <id> [--template turn\|realtime\|offline] [--name "Name"]` | Creates `modes/<id>` from a template that already passes `check` |
| `npx brawl-modes dev <id> [--players N]` | Plays the mode in the browser, every player side by side (http://localhost:5173) |
| `npx brawl-modes test <id> [--seed N --runs 1]` | Fuzz, sync, determinism, hydration and size checks |
| `npx brawl-modes bench <id>` | Server cost in work units against the server's gates |
| `npx brawl-modes check <id> [--json]` | Everything review runs: policy, test, bench, build hashes |
| `npx brawl-modes build <id>` | Writes `modes/<id>/dist/` and prints the hashes a reviewer approves |
| `npx brawl-modes publish <id>` | Runs `check`, then submits the mode for review (needs `BRAWL_MODES_TOKEN`) |
| `npx brawl-modes status [<submission> \| <id>] [--wait]` | The state of a submission, a mode's submissions, or your modes |

`<id>` is a folder name under `modes/`, or a path to a mode folder. Every command takes `--json` for one
machine-readable result object on stdout (the human report goes to stderr).

## Pick a template

| Template | Use it for | Server |
|---|---|---|
| `turn` (default) | Turn-based and board games: players act in order, nothing moves on its own | `tickRate: 0`, all logic in `onAction` |
| `realtime` | Things that move: positions, timers, physics | `tickRate` 1-30, actions set intent, `onTick` moves the world |
| `offline` | Single-player toys that need no server and no verified score | none: the client is the whole game |

Online modes (turn and realtime) are multiplayer and their results are verified. Offline modes earn nothing.

## How an online mode works

```
client/index.html --game.send(action)--> server.js onAction(state, action, ctx) --ctx.emit(step)--> every client
                                         server.js onTick(state, dtMs, ctx)     --ctx.emit(step)--> client/model.js apply(step)
```

| File | Role | Runs |
|---|---|---|
| `mode.json` | Identity, players, `tickRate`, files, store listing (schema: the kit's `schema/mode.schema.json`) | |
| `shared.js` | Constants and pure rule helpers used by both sides | server and client |
| `server.js` | `defineMode({ setup, onAction, onTick?, onPlayerStatus?, sync, result })`: the only authority on the rules | server sandbox |
| `client/model.js` | `createModel()`: the client's picture of the match, rebuilt from steps only, no DOM | browser and `test` |
| `client/index.html` | Renders the model, sends actions with `connect()` from `@blockbrawl/mode-sdk/client` | browser |
| `tests/fuzz.js` | `nextAction(model, playerId, rng)`: a plausible action or `null`, used by `test` and `bench` | `test` |

- **`state`** (returned by `setup`, passed to every callback) is plain JSON and the only place match data lives.
  The platform saves it and may restore it in a fresh sandbox at any moment.
- **Steps** are small JSON facts (`{ t: 'move', p: 1, x: 3, y: 4 }`) sent with `ctx.emit(step)`, or to one player
  with `ctx.emit(step, { to: playerId })`. Every change a client can see needs a step.
- **`sync(state, playerId)`** returns the steps that rebuild, from nothing, everything that player may see. It is
  used for joins, reconnects and lost batches. It must be read-only.
- **The model** applies steps in one `apply(step)` function shared by `applySync` and `applySteps`, so a synced
  client and a live client cannot drift apart. `snapshot()` returns the server-confirmed picture as plain JSON.
- **`result(state)`** returns `null` while the match runs, then `{ ranking, scores? }`: `ranking` lists every
  player id exactly once, first place first; ties are nested arrays (`[["a", "b"], "c"]`).
- Types for everything: the kit's `sdk/types.d.ts`. `jsconfig.json` in this folder points editors at them.

## Workflow

1. `npx brawl-modes new <id> --template <turn|realtime|offline>`, then run `check` once: it passes as generated.
2. Put the rules in `shared.js` (constants, pure helpers) and `server.js`.
3. For every step type the server emits, add a case to `apply` in `client/model.js`, and make `sync` emit what is
   needed to rebuild it.
4. Update `tests/fuzz.js` so random players make legal moves most of the time (garbage input is added for you).
5. Build the UI in `client/index.html` from the model only.
6. Fill in the store listing in `mode.json` (`name`, `tagline`, `description`, `tags`, `orientation`) and add a
   `thumb.webp`, `thumb.png` or `thumb.jpg` (640 x 360, at most 512 KB).
7. `npx brawl-modes check <id>` until it prints `READY TO SUBMIT`. Then `npx brawl-modes dev <id>` to play it.
8. To submit, `npx brawl-modes publish <id>`, then `npx brawl-modes status <submission> --wait`. Publishing needs
   the creator token in `BRAWL_MODES_TOKEN`; if it is not set, ask the person you work for. Never write the token
   into a file. Publish only when the person asks you to.
9. Every later change that you submit needs a higher `version` in `mode.json`.

## Rules that fail review

| Rule | Why | Do this instead |
|---|---|---|
| No `Math.random` in any source (server or client) of an online mode | Replays and restores must give identical results | `ctx.rng.next()`, `int(n)`, `pick(a)`, `shuffle(a)` on the server; a small seeded generator in the client for visual effects |
| No `eval`, `new Function`, dynamic `import()`, network (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`), workers, typed arrays (`ArrayBuffer`, `Uint8Array`, `DataView` ...) | Not available in the sandbox | Plain arrays and objects; everything the client needs is imported from the mode folder |
| No match data outside `state` (module-level `let`, caches, closures) | The match moves between sandboxes; that data is lost and `test` reports `hydration` | Keep it in `state`; module-level `const` lookup tables are fine |
| Validate before mutating in `onAction` | A rejected action must leave state exactly as it was (`fuzz: a rejected action changed state`) | All `throw reject('reason')` checks first, then change state |
| Every visible change has a step | Otherwise `sync` and live clients differ (`sync: ... differs`) | Emit a step wherever state that a client shows changes |
| `sync` covers everything | Late joiners and reconnects rebuild only from `sync` | One `state` step with the full visible picture is fine |
| Hidden information goes only to its owner | Every client receives every broadcast step | `ctx.emit(step, { to: playerId })`, and send only that player's part in `sync(state, playerId)` |
| Small steps | Data is most of the server cost (`bench`) | Ids and deltas, not whole objects; full state only in `sync` |
| No throwing except `reject` | Any other exception aborts the match | Guard against bad input; actions come from untrusted clients (garbage is fuzzed) |
| No external resources in the client | The client frame has no network | Import images, sounds and CSS relatively; the build inlines them |

The policy check is a plain text search over `.js`, `.html`, `.css` and `.json` files outside `tests/`, so it also
matches those words in comments and strings (lowercase `fetch` in a description, for example). Rephrase them.
Offline modes may use `Math.random`; everything else applies to them too.

## Reading failures

| `check` says | Meaning | Fix |
|---|---|---|
| `Invalid mode.json` | A key is missing, misspelled or out of range | Follow the message; the schema lists every key |
| `policy FAIL ... uses X` | A forbidden word in a source file | See the rules above |
| `fuzz: ... threw` | A callback threw on some input | Reproduce with the printed `--seed N --runs 1` and guard the input |
| `fuzz: a rejected action changed state` | Mutation before `reject` | Move all checks above the first change |
| `sync: ... differs` | The model after `sync` is not the model after live steps | Compare the printed difference: a step or the `sync` output is missing data |
| `determinism` | Same seed, different output | Depend only on `state`, the action and `ctx` (`ctx.rng`, `ctx.timeMs`) |
| `hydration` | Data outside `state` | Move it into `state` |
| `result: ranking must list every player` | Missing or repeated player in `ranking` | Include every `state` player, including those who left |
| `bench ... over the limit` | Too much server work per call or per match-second | See the hints it prints; `docs/benchmark.md` explains the numbers |
| `budget:` | Bundle or client too big | Smaller assets; do not bundle large libraries |

## Limits (from the kit's `runtime/limits.json`)

Tick rate at most 30 per second; state at most 256 KB; at most 256 steps per call and 16 KB per step batch;
actions at most 4 KB; server bundle 256 KB; built client 5 MB; 30 actions per second per player. `bench` gates:
1,000,000 work units for the most expensive call and 500,000 per match-second. Work units count function calls,
loop passes and bytes of steps, and are identical on every machine.

## More

The kit's `docs/` folder (in a workspace: `node_modules/@blockbrawl-game/community-kit/docs/`):
`getting-started.md`, `interfaces.md`, `steps-and-sync.md`, `prediction.md` (instant feedback for fast modes),
`benchmark.md`, `limits.md`, `offline-modes.md`, `listing.md`, `publishing.md`. Working examples are in the kit's `modes/` folder:
`duel-lite` (smallest turn-based), `stack-race`, `tile-frenzy` (8 players, 30 ticks), `trail-clash`,
`bloom-blocks` and `tap-rush` (offline).
