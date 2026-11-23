# Roadmap: developer support

Where the kit is going, in order. Each step ships as its own release.

## 1. Benchmark and `check` (in progress, 0.5.0)

- `brawl-modes bench <mode>`: the server cost of a mode in **work units**, identical on every machine, checked
  against two gates in `runtime/limits.json` (`maxWorkPerCall`, `maxWorkPerSecond`). See
  [benchmark.md](benchmark.md).
- `brawl-modes check <mode>`: everything review runs (source policy, `test`, `bench`, `build`) with one verdict
  and `--json` output.
- CI proves the units are machine-independent: the example modes must reproduce `scripts/bench-baseline.json`
  exactly.

## 2. Agent-first documentation

Most modes will be written with an AI assistant, so the kit must be usable by one from the first prompt:

- `AGENTS.md` and `CLAUDE.md` at the root and in `modes/`: the rules, the exact commands, what "done" means
  (`check` passes), and the mistakes that fail review.
- `brawl-modes new <id>` to start from a template; CLI help without internal names.
- Editor support: `jsconfig.json` for autocomplete from `sdk/types.d.ts`, and a JSON schema for `mode.json`.
- A getting-started guide, a guide for offline modes, a README per example saying what it teaches, store listing
  metadata, and a changelog with the versioning rules.

## 3. Submitting modes: `brawl-modes publish`

Creators will submit a mode version from their own machine, without opening a pull request here:

- `brawl-modes publish <mode>` uploads the mode's source with a creator token.
- The server builds it with the pinned kit and runs the same `check` (including `bench`) in an isolated worker.
- A person reviews and plays it; approved versions go live without a game release.

Until then, modes are submitted as pull requests to this repository (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
