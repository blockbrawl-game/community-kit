# Roadmap: developer support

Where the kit is going, in order. Each step ships as its own release.

## 1. Benchmark and `check` (done, 0.5.0)

- `brawl-modes bench <mode>`: the server cost of a mode in **work units**, identical on every machine, checked
  against two gates in `runtime/limits.json` (`maxWorkPerCall`, `maxWorkPerSecond`). See
  [benchmark.md](benchmark.md).
- `brawl-modes check <mode>`: everything review runs (source policy, `test`, `bench`, `build`) with one verdict
  and `--json` output.
- CI proves the units are machine-independent: the example modes must reproduce `scripts/bench-baseline.json`
  exactly.

## 2. Agent-first documentation (done, 0.6.0)

- `brawl-modes new <id> --template turn|realtime|offline`: a new mode that passes `check` as generated, plus
  `AGENTS.md`, `CLAUDE.md` and `jsconfig.json` for the workspace.
- `schema/mode.schema.json`, and stricter `mode.json` checks (unknown keys, orientation, thumbnail size).
- [getting-started.md](getting-started.md), [offline-modes.md](offline-modes.md), [listing.md](listing.md), a
  README per example, and [CHANGELOG.md](../CHANGELOG.md) with the versioning rules.

## 3. Submitting modes: `brawl-modes publish`

Creators will submit a mode version from their own machine, without opening a pull request here:

- `brawl-modes publish <mode>` uploads the mode's source with a creator token.
- The server builds it with the pinned kit and runs the same `check` (including `bench`) in an isolated worker.
- A person reviews and plays it; approved versions go live without a game release.

Until then, modes are submitted as pull requests to this repository (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
