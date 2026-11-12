# Status and handoff

Last updated: 2026-11-12. The approved plan is in [plan.md](plan.md).

## Done: milestone 1 (contract + dev kit, no backend)

- `sdk/`, `runtime/prelude.js`, `shell/`, `devkit/` (`dev`, `test`, `build`), reference modes `duel-lite` and `stack-race`, docs.
- `npm test` passes for both modes. `devkit test broken-sync` and `devkit test broken-hidden-state` fail on purpose.
- Both modes were played in a browser, including late join, simulated latency and dropped batches.

## Differences from the plan

- The mode client is built into one self-contained HTML document and loaded through `srcdoc` into the sandboxed frame. Sub-requests from an opaque-origin frame failed in testing, so mode clients have no network access at all.
- The per-call watchdog is 250 ms (`runtime/limits.json`). 50 ms tripped on system hiccups. Use the same value for the ClearScript watchdog.
- Each mode must ship `tests/fuzz.js` exporting `nextAction`, and `client/model.js` exporting `createModel` with no DOM access.

## Next: milestone 2 (V8 runtime in .NET)

Needs the .NET 10 SDK, which was not installed on the machine where milestone 1 was built.

1. New project `src/Platform/BrawlPlatform.Core.Scripting`: `ScriptSandbox` on `Microsoft.ClearScript.V8`, evaluating `community/runtime/prelude.js` and then the mode's `server.bundle.js`, and calling `__bb.setup/action/tick/status/sync/exportState/importState` with JSON strings.
2. New project `src/Modules/BlockBrawl.Modules.CommunityModes`: `JsGameLogic`, `ModeRegistry`.
3. New `tests/BlockBrawl.CommunityModes.Tests`. Parity test: replay `community/devkit/fixtures/recordings/*.json` and compare `expect.outputHash` and `expect.stateHash`.
   - Output hash: start with the hex SHA-256 of `blockbrawl-mode-v1`; for every setup, action, tick and status call, hash = hex SHA-256 of (previous hex + raw JSON string returned by the prelude). See `devkit/match.js`.
   - State hash: hex SHA-256 of the string returned by `__bb.exportState()`.
   - Limits tests: infinite loop interrupted, heap bomb contained, oversized state rejected.

## Then: milestone 3 (Orleans + gateway)

`CommunityMatchGrain`, snapshot store, `/modehub` with match-scoped tickets, `CommunityStreamManager`, silo role placement, and a SignalR transport for the shell (`devkit dev --remote`). The wire protocol to keep is documented at the top of `devkit/match.js`.

## Setting up on another machine

```bash
git fetch origin
git switch feature/community-modes
cd community
npm install
npm test
node devkit/cli.js dev duel-lite
```
