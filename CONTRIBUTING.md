# Contributing

To put your own mode in the game, publish it: `brawl-modes publish` ([docs/publishing.md](docs/publishing.md)).
This repository takes pull requests for the kit itself and for example modes.

## Contributing an example mode

1. `npm ci`, then `node devkit/cli.js dev duel-lite` to see how a mode behaves.
2. `node devkit/cli.js new <your-id> --template turn|realtime|offline` creates `modes/<your-id>/` from a template that
   passes every check. [`modes/AGENTS.md`](modes/AGENTS.md) has the rules and the workflow (also for your AI assistant).
3. Develop with `node devkit/cli.js dev <your-id>`; test with `node devkit/cli.js test <your-id>`.
4. Run `node devkit/cli.js check <your-id>` before opening a PR; it must print `READY TO SUBMIT`. It runs everything review runs: the source policy, `test`, `bench` (the server's performance gates, in work units that are the same on every machine) and `build`. CI runs the same check.
5. Open a PR with one mode. Read the checklist in the template.

## Changing the kit

Read [AGENTS.md](AGENTS.md): build hashes and work units are contracts, the three manifest checks must agree, and
every change gets a [CHANGELOG.md](CHANGELOG.md) entry.

## How review works

- A maintainer reads `server.js` and `shared.js` in full, plays the mode, and checks the client for anything that looks like abuse.
- Passing CI is necessary, not sufficient. Merging does **not** put a mode live. The server only loads a bundle whose sha256 is pinned in the game server's private approval list, and a maintainer adds that after review.
- Changing an approved mode changes its hash, so it is reviewed again. Bump `version` for every change.
- PRs that touch `runtime/`, `devkit/`, `sdk/`, `shell/`, `scripts/` or `.github/` need a maintainer who owns that area, and are held to a higher bar.

## Ground rules

- No network access, no eval, no typed arrays; use `ctx.rng`, never `Math.random`, in any file of an online mode (an offline mode, with no server, may use `Math.random`). The full source policy is in [docs/limits.md](docs/limits.md#the-source-policy).
- Keep within the limits in `runtime/limits.json` (state size, call time, bundle size).
- No new npm dependencies in a mode PR.
- Be kind. Maintainers may close PRs that are spam, off-topic, or low effort without a long explanation.

By opening a pull request you agree that your contribution is licensed under this repository's [MIT license](LICENSE).
