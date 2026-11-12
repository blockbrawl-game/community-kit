# Status and handoff

Last updated: 2026-11-12. The approved plan is in [plan.md](plan.md).

## Done: milestone 1 (contract + dev kit, no backend)

- `sdk/`, `runtime/prelude.js`, `shell/`, `devkit/` (`dev`, `test`, `build`), reference modes `duel-lite` and `stack-race`, docs.
- `npm test` passes for both modes. `devkit test broken-sync` and `devkit test broken-hidden-state` fail on purpose.
- Both modes were played in a browser, including late join, simulated latency and dropped batches.

## Done: milestone 2 (V8 runtime in .NET)

- `src/Platform/BrawlPlatform.Core.Scripting`: `ScriptSandbox` on ClearScript V8, one isolate per instance, strings in and out, heap monitor, per-call watchdog, compiled-code cache per `ScriptSource`.
- `src/Modules/BlockBrawl.Modules.CommunityModes`: `CommunityMatch` (the server twin of `devkit/match.js`), `JsGameLogic`, `ModeRegistry`, contracts, `ModeLimits`. The prelude and `limits.json` are embedded into the assembly.
- `tests/BlockBrawl.CommunityModes.Tests`: 53 tests, about 2 seconds. Fast suite, safe to run without asking. Needs Node and `npm install` in `community/`, because the fixture builds the reference modes with `devkit build`.
  - Parity: both recordings in `devkit/fixtures/recordings/` replay to the dev kit's `outputHash` and `stateHash`, also across sandbox restarts and across snapshot + restore.
  - Limits: an infinite loop is interrupted, a heap bomb is contained, an oversized state, step batch or step count aborts the match.

```bash
dotnet test tests/BlockBrawl.CommunityModes.Tests
```

### Things found on the way

- **ClearScript is pinned to 7.4.5.** In 7.5.0 and 7.5.1 a loop that calls `new Array(n)` ignores both `Interrupt()` and the heap monitor; the process grew past 4 GB with a 32 MB limit. `ScriptSandboxTests.HeapBomb_IsContained` and `ArrayLoop_IsInterruptedByTheWatchdog` guard this. Run them before upgrading.
- **Typed arrays and `ArrayBuffer` are removed in the prelude.** Their memory lives outside the JavaScript heap, so the heap limit does not see it. This applies to the dev kit too, since the prelude is shared.
- **`eval` and `new Function` still work on the server.** The dev kit blocks them (Node `vm` option); ClearScript has no equivalent switch. A mode that uses them fails `devkit test`, so it cannot pass review, but the server does not enforce it.
- **The heap limit is enforced at V8 interrupt checks, not inside a native call.** The bombs tried so far (arrays, objects, 256 MB strings) were stopped in about 80 ms, but a single built-in call can still overshoot the limit before the script is stopped. Put a memory limit on the community silo's container as the backstop.

## Differences from the plan

- The mode client is built into one self-contained HTML document and loaded through `srcdoc` into the sandboxed frame. Sub-requests from an opaque-origin frame failed in testing, so mode clients have no network access at all.
- The per-call watchdog is 250 ms (`runtime/limits.json`). 50 ms tripped on system hiccups. The ClearScript watchdog uses the same value.
- Each mode must ship `tests/fuzz.js` exporting `nextAction`, and `client/model.js` exporting `createModel` with no DOM access.
- The registry reads `<mode>/dist/server.bundle.js`, so a mode must be built with `devkit build <mode>` before the server can load it.
- State, batch and step limits are enforced in `CommunityMatch` rather than in `ScriptSandbox`, which stays game-agnostic. They still surface as an aborted match with the limit name.

## Next: milestone 3 (Orleans + gateway)

`CommunityMatchGrain`, snapshot store, `/modehub` with match-scoped tickets, `CommunityStreamManager`, silo role placement, service registration behind `CommunityModes:Enabled`, Dockerfile entries, and a SignalR transport for the shell (`devkit dev --remote`). The wire protocol to keep is documented at the top of `devkit/match.js`.

What the grain has to do that `IGameLogic` cannot express (also in the summary comment of `JsGameLogic`):

1. Broadcast `CommunityMatch.DrainPendingEvents()` in `OnSessionStartedAsync`; `InitializeAsync` cannot return the opening steps.
2. Turn a validation failure (`ActionValidationResult.RejectReason`) into a `rejected` message for the sender.
3. Call `CommunityMatch.SetStatus` on disconnect, reconnect and forfeit.
4. Route events by `TargetPlayerId`; null means everyone in the match.
5. After a sync, also send the result or abort if the match has ended.
6. Dispose the match in `OnDeactivateAsync`, and call `AnchorClock` after restoring from a snapshot.

Before starting: `tests/BlockBrawl.IntegrationTests` does not compile on this branch (`CS0433`, `Program` exists in both Gateway and Silo). The branch does not touch that code, so `main` is probably the same; not checked. Milestone 3 changes both hosts, so fix that first.

## Setting up on another machine

```bash
git fetch origin
git switch feature/community-modes
cd community
npm install
npm test
node devkit/cli.js dev duel-lite
```
