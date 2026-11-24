# Getting started: your first mode

From an empty folder to a mode that passes review's automatic checks, in about fifteen minutes. Written so that a
person or an AI assistant can follow it step by step. You need Node 20 or newer.

## 1. Make a workspace

```bash
mkdir my-modes
cd my-modes
npm init -y
npm pkg set type=module
npm install --save-exact https://github.com/blockbrawl-game/community-kit/releases/download/v0.7.0/blockbrawl-game-community-kit-0.7.0.tgz
```

The kit is a GitHub release file, not an npm registry package: no account or token is needed, and npm pins its
integrity hash in `package-lock.json`.

## 2. Create a mode

```bash
npx brawl-modes new coin-chase --template realtime
```

| Template | For |
|---|---|
| `turn` (the default) | Turn-based and board games: nothing moves between actions |
| `realtime` | Things that move on their own: positions, timers, physics |
| `offline` | Single-player toys with no server (see [offline-modes.md](offline-modes.md)) |

This creates `modes/coin-chase/` and, the first time, the workspace files:

| File | For |
|---|---|
| `AGENTS.md` | The rules and the workflow, for AI assistants (Codex, Cursor, Copilot and others read it) |
| `CLAUDE.md` | Points Claude Code at `AGENTS.md` |
| `jsconfig.json` | Autocomplete and type checking from the SDK's types in VS Code and other editors |
| `.gitignore` | Leaves `node_modules/` and `dist/` out of git |

`mode.json` points at the kit's JSON schema (`$schema`), so editors complete and check its keys too.

## 3. Check it

```bash
npx brawl-modes check coin-chase
```

A new mode passes as generated: the output ends with `READY TO SUBMIT`. This is the command that matters. Review
runs exactly the same command with the same numbers, so a mode that passes here passes review's automatic part.

## 4. Play it

```bash
npx brawl-modes dev coin-chase --players 2
```

Open the printed URL: every player side by side, a message log, the server state, and sliders for latency and
dropped packets.

## 5. Make it yours

Change the rules in `shared.js` and `server.js`, then keep the other files in step:

1. **Every step the server emits** needs a case in `apply` in `client/model.js`.
2. **`sync`** must emit everything a newly joined player needs to rebuild the picture.
3. **`tests/fuzz.js`** should make legal moves most of the time; the kit adds garbage input on its own.
4. **`client/index.html`** draws the model and sends actions.
5. **`mode.json`**: the store listing (`name`, `tagline`, `description`, `tags`, `orientation`) and a thumbnail.
   See [listing.md](listing.md).

Run `check` after every change you consider finished. When something fails, the message says what and where; the
tables in `AGENTS.md` map every failure to its fix.

With an AI assistant, a good first prompt is:

> Read AGENTS.md. Turn modes/coin-chase into <your idea>. Keep `npx brawl-modes check coin-chase` passing and run
> it before you say you are done.

## 6. Learn from the examples

The kit's example modes are working, reviewed code. Each has a README saying what it teaches:

| Example | Shows |
|---|---|
| `duel-lite` | The smallest turn-based mode: hidden hands, validation, sync |
| `stack-race` | Ticking and client prediction |
| `tile-frenzy` | 8 players at 30 ticks a second, contested actions |
| `trail-clash` | Queued input, prediction and interpolation |
| `bloom-blocks` | A rich client: drag and drop, particles, animation |
| `tap-rush` | An offline mode |

Run any of them by id, for example `npx brawl-modes dev duel-lite`. Their sources are in
`node_modules/@blockbrawl-game/community-kit/modes/`.

## Next

- [interfaces.md](interfaces.md): everything a mode implements.
- [steps-and-sync.md](steps-and-sync.md): keeping clients consistent and steps small.
- [prediction.md](prediction.md): making fast modes feel instant.
- [benchmark.md](benchmark.md): the server's performance gates, in work units.
- [limits.md](limits.md): the sandbox and every limit.
- [publishing.md](publishing.md): submitting the mode with `brawl-modes publish`.
