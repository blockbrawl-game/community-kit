# BlockBrawl community modes SDK

SDK, dev kit and example modes for writing custom BlockBrawl game modes in HTML5/JS. MIT licensed.

A mode has two halves:

- **Server logic** (`server.js`) runs on the BlockBrawl servers inside a V8 sandbox. It is the only authority on the rules.
- **Client** (`client/`) is an HTML5 app that renders the match and sends the player's actions. It runs in a sandboxed frame with no network access.

The two halves talk through **steps**: small JSON facts the server emits and the client applies. When a player joins or reconnects, the server sends a **sync**: the steps that rebuild that player's view from nothing.

> **Using an AI assistant?** Point it at [`AGENTS.md`](AGENTS.md) (in this repository) or at the `AGENTS.md`
> that `brawl-modes new` writes into your folder. It has the commands, the rules that fail review, and what "done"
> means: `brawl-modes check <mode>` prints `READY TO SUBMIT`. Claude Code reads it through `CLAUDE.md`.

## Quick start

Requires Node 20 or newer. In an empty folder:

```bash
npm init -y
npm pkg set type=module
npm install --save-exact https://github.com/blockbrawl-game/community-kit/releases/download/v0.6.0/blockbrawl-game-community-kit-0.6.0.tgz
npx brawl-modes new my-mode --template turn
npx brawl-modes check my-mode
npx brawl-modes dev my-mode
```

`new` creates `modes/my-mode/` from a template (`turn`, `realtime` or `offline`) that already passes `check`,
plus `AGENTS.md`, `CLAUDE.md` and `jsconfig.json` for your assistant and editor. The full walkthrough is
[docs/getting-started.md](docs/getting-started.md).

| Command | What it does |
| --- | --- |
| `brawl-modes new <id> [--template turn\|realtime\|offline]` | A new mode that passes `check` as generated |
| `brawl-modes dev <mode> [--players N]` | Plays the mode in the browser: every player side by side, latency and packet-drop sliders, a message log and the live server state |
| `brawl-modes test <mode>` | Fuzz, sync, determinism, hydration and size checks |
| `brawl-modes bench <mode>` | Server cost in work units, the same on every machine, against the server's gates |
| `brawl-modes check <mode>` | Everything review runs, with one verdict: run this before submitting |
| `brawl-modes build <mode>` | Writes `modes/<mode>/dist` and prints the hashes a reviewer pins |

Every command takes `--json` for one machine-readable result object on stdout. A mode id is looked up in your
`./modes` first, then in this kit's examples, so `npx brawl-modes dev duel-lite` works anywhere.

### Installing

Every release is a git tag (`vX.Y.Z`) with a GitHub release that has the packed kit attached. There is no npm
registry package and no token is needed. npm pins the release file's integrity hash in your lockfile, and it needs
neither git nor an SSH key, so it also works in container builds. (`npm install
github:blockbrawl-game/community-kit#v0.6.0` works too, but records a `git+ssh` URL that needs git and GitHub SSH
access on every machine that runs `npm ci`.) What changed in each release: [CHANGELOG.md](CHANGELOG.md).

### Working in this repository

```bash
npm ci
npm test                          # unit tests, then check on every example
node devkit/cli.js dev duel-lite  # npx brawl-modes ... is node devkit/cli.js ... here
```

## Layout

| Folder | What it is |
| --- | --- |
| `sdk/` | `defineMode`, `reject`, `connect`, `connectOffline` and the TypeScript interfaces (`types.d.ts`) |
| `runtime/` | The sandbox prelude and limits shared by the dev kit and the real server |
| `shell/` | The trusted host page code that wraps a mode client |
| `devkit/` | The `brawl-modes` command: `new`, `dev`, `test`, `bench`, `check`, `build` |
| `templates/` | The `turn`, `realtime` and `offline` templates and the workspace files `new` writes |
| `schema/` | The JSON schema of `mode.json` |
| `modes/duel-lite/` | Turn-based reference mode: steps, private hands, sync |
| `modes/stack-race/` | Real-time reference mode: ticking and client prediction |
| `modes/tap-rush/` | Offline reference mode: no server, the whole game is the client |
| `modes/tile-frenzy/` | Showcase, load test: 1-8 players at 30 ticks a second grabbing tiles on a shared board |
| `modes/trail-clash/` | Showcase, real time: 1-4 light trails at 20 ticks a second, queued turns, a shrinking arena |
| `modes/bloom-blocks/` | Showcase, visuals: turn-based placement puzzle for 1-2 players with drag and drop and particle effects |
| `scripts/check-modes.mjs` | The CI gate: `check` on every mode, and bench numbers equal to `scripts/bench-baseline.json` |
| `docs/` | Guides |

## A mode package

```
modes/<mode-id>/
  mode.json          id, version, player counts, tickRate, file names
  server.js          export default defineMode({ ... })
  shared.js          optional rules used by both halves
  client/index.html  the client page
  client/model.js    export function createModel()  (no DOM access)
  tests/fuzz.js      export function nextAction(model, playerId, rng)
  README.md          optional: what the mode is
  thumb.webp         optional: the store image (640 x 360, at most 512 KB)
```

Start with `brawl-modes new`. Every example has a README saying what it teaches.

## Docs

- [Getting started](docs/getting-started.md): your first mode, step by step.
- [Interfaces](docs/interfaces.md): what a mode must implement.
- [Steps and sync](docs/steps-and-sync.md): how to keep clients consistent and bandwidth low.
- [Prediction](docs/prediction.md): making fast-paced modes feel instant.
- [Limits and testing](docs/limits.md): the sandbox rules and what `brawl-modes test` checks.
- [Benchmark](docs/benchmark.md): work units, the server's two performance gates, and how to get under them.
- [Offline modes](docs/offline-modes.md): single-player modes with no server.
- [The store listing](docs/listing.md): name, tagline, description, tags and thumbnail.
- [Roadmap](docs/roadmap.md): what is coming for mode developers, in order.

## How a mode goes live

1. Open a pull request with one mode under `modes/<your-id>/`. CI runs `node scripts/check-modes.mjs`, which runs `brawl-modes check` on every mode.
2. A maintainer reads the code and plays the mode.
3. The game server pins each accepted mode by the hash of its build. Merging here does **not** put a mode live, and an update only goes live after the same review.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## Releases

The game server embeds `runtime/` and `shell/`, and a mode's approved hash depends on the kit version that built
it, so the game pins one exact release. A release bumps `version` in `package.json` and `npm-shrinkwrap.json`, and
adds a [CHANGELOG.md](CHANGELOG.md) entry, and
then the Release workflow (run it from the Actions tab, or push the tag `v<version>`) checks every mode, creates
the tag and a GitHub release with notes and the packed kit attached.

## License

[MIT](LICENSE).

