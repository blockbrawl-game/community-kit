# Contributing a mode

1. `npm install`, then `node devkit/cli.js dev duel-lite` to see how a mode behaves.
2. Copy a reference mode from `modes/` to `modes/<your-id>/` and change `mode.json` (`id` must equal the folder name).
3. Develop with `node devkit/cli.js dev <your-id>`; test with `node devkit/cli.js test <your-id>`.
4. Run `node scripts/check-modes.mjs <your-id>` before opening a PR. CI runs the same script.
5. Open a PR with one mode. Read the checklist in the template.

## How review works

- A maintainer reads `server.js` and `shared.js` in full, plays the mode, and checks the client for anything that looks like abuse.
- Passing CI is necessary, not sufficient. Merging does **not** put a mode live. The server only loads a bundle whose sha256 is pinned in the game server's private approval list, and a maintainer adds that after review.
- Changing an approved mode changes its hash, so it is reviewed again. Bump `version` for every change.
- PRs that touch `runtime/`, `devkit/`, `sdk/`, `shell/`, `scripts/` or `.github/` need a maintainer who owns that area, and are held to a higher bar.

## Ground rules

- No network access, no eval, no typed arrays on the server; use `ctx.rng`, never `Math.random`.
- Keep within the limits in `runtime/limits.json` (state size, call time, bundle size).
- No new npm dependencies in a mode PR.
- Be kind. Maintainers may close PRs that are spam, off-topic, or low effort without a long explanation.
