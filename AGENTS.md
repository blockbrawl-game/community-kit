# community-kit: instructions for AI assistants

This repository is the public SDK and dev kit for BlockBrawl community game modes (MIT). There are two kinds of
work here; find out which one you are doing first.

- **Building or changing a game mode** (in `modes/<id>/`): follow [`modes/AGENTS.md`](modes/AGENTS.md). It is
  the same guide that `brawl-modes new` writes into a creator's own folder. Start with
  `node devkit/cli.js new <id> --template turn|realtime|offline`.
- **Changing the kit itself** (`devkit/`, `sdk/`, `runtime/`, `shell/`, `templates/`, `schema/`, `docs/`): read
  the rest of this file.

In this repository `npx brawl-modes <command>` is `node devkit/cli.js <command>` (or `npm run <command> -- <args>`).

## Layout

| Path | What it is | Who uses it |
|---|---|---|
| `sdk/` | `server.js` (`defineMode`, `reject`), `client.js` (`connect`), `offline.js` (`connectOffline`), `types.d.ts` | Mode code, bundled into every mode |
| `runtime/` | `prelude.js` (the sandbox side of the server runtime) and `limits.json` (every limit) | Embedded by the game server; changing them changes the server |
| `shell/` | The play page that hosts a mode frame | Embedded by the game gateway |
| `devkit/` | The `brawl-modes` CLI: `new`, `dev`, `test`, `bench`, `check`, `build` | Creators and the review server |
| `templates/` | `turn`, `realtime`, `offline` and the `workspace` files `new` writes | `brawl-modes new` |
| `schema/mode.schema.json` | JSON schema of `mode.json` | Editors; must agree with `validateManifest` in `devkit/build.js` |
| `modes/` | The example modes, which are also the reference for the docs | Everyone |
| `devkit/fixtures/` | Broken modes that each must fail one check | Tests |
| `scripts/` | `check-modes.mjs` and `bench-baseline.json` | CI |
| `tests/` | node:test unit tests | CI |

## Commands

```bash
npm ci
npm test                                       # unit tests, then check on every mode against the bench baseline
node --test "tests/**/*.test.mjs"              # unit tests only
node scripts/check-modes.mjs --baseline        # every mode; bench numbers must equal scripts/bench-baseline.json
node scripts/check-modes.mjs --update-baseline # after an intended change to the work-unit numbers
node devkit/cli.js check duel-lite             # one mode
```

## Rules for kit changes

- **Hashes are a contract.** The game server approves modes by the sha256 of their built bundle and client
  (`id@version` and `id@version#client`). Anything that changes a build output (esbuild version or options, the
  `sdk/` files, `inBuildRoot` in `devkit/build.js`) changes every approved hash. Say so in `CHANGELOG.md`, and
  the game must re-approve its modes when it takes the release.
- **Work units are a contract.** `devkit/work.js` and the bench must give the same numbers on every machine;
  CI requires `scripts/bench-baseline.json` exactly. Update the baseline only for an intended change, and say
  why in the commit.
- **The runtime is the server.** `runtime/prelude.js` and `runtime/limits.json` are embedded by the game server.
  A change there is a server change; keep it backward compatible within the SDK line (`0.1`).
- **The checks must agree.** `validateManifest` (`devkit/build.js`), `schema/mode.schema.json` and the server's
  `ParseManifest` enforce the same rules. `devkit/policy.js` is the source policy that review runs.
- **Templates must pass `check` as generated.** `tests/new.test.mjs` creates a mode from each template and runs
  `check` on it.
- **`modes/AGENTS.md` and `templates/workspace/AGENTS.md` are the same file.** Edit one, copy it to the other;
  a test fails when they differ.
- **Docs follow the code.** A new command, flag, limit or rule goes into `README.md`, the relevant page in
  `docs/`, the agent guide and `CHANGELOG.md` in the same change.
- No new runtime dependencies without a reason: every creator installs them.

## Releases

Bump `version` in `package.json` and `npm-shrinkwrap.json`, add the `CHANGELOG.md` entry and update the install
URL in `README.md` and `docs/getting-started.md`. After the merge, run the **Release** workflow (Actions,
`workflow_dispatch`): it tests, packs, tags `v<version>` and attaches the `.tgz` to a GitHub release. There is
no npm registry package; installs use the release file URL.
