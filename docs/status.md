# Status and handoff

Last updated: 2026-11-13. The approved plan is in [plan.md](plan.md).

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
- **`eval` and every function constructor are closed in the prelude.** The dev kit host already refused code from strings (Node `vm` option); ClearScript has no such switch, so the prelude now removes `eval` and makes `Function` and the async/generator constructors throw. Both hosts behave the same.
- **The heap limit is enforced at V8 interrupt checks, not inside a native call.** The bombs tried so far (arrays, objects, 256 MB strings) were stopped in about 80 ms, but a single built-in call can still overshoot the limit before the script is stopped. Put a memory limit on the community silo's container as the backstop.

## Differences from the plan

- The mode client is built into one self-contained HTML document and loaded through `srcdoc` into the sandboxed frame. Sub-requests from an opaque-origin frame failed in testing, so mode clients have no network access at all.
- The per-call watchdog is 250 ms (`runtime/limits.json`). 50 ms tripped on system hiccups. The ClearScript watchdog uses the same value.
- Each mode must ship `tests/fuzz.js` exporting `nextAction`, and `client/model.js` exporting `createModel` with no DOM access.
- The registry reads `<mode>/dist/server.bundle.js`, so a mode must be built with `devkit build <mode>` before the server can load it.
- State, batch and step limits are enforced in `CommunityMatch` rather than in `ScriptSandbox`, which stays game-agnostic. They still surface as an aborted match with the limit name.

## Done: milestone 3 (Orleans + gateway)

- **Grain** `CommunityMatchGrain` (`blockbrawl.communitymatch`, stream namespace `CommunityMatch`) on the shared session engine. It adds what `IGameLogic` cannot express: rejections as events, player status forwarding, a sync for every player at start and on request, its own disconnect grace per player, and JSON-state snapshots (at start, every 5 actions, every 10 seconds, and on deactivation).
- **Snapshots** `CommunityMatchStore` (`MartenCommunityMatchStore` in production). Restoring recreates the sandbox from the pinned mode version and hash. A storage failure while loading fails the call and is retried; it is never mistaken for "no such match".
- **Gateway** `/modehub` (`CommunityHub`), authenticated by a second JWT scheme: a match-scoped ticket naming one player and one match. `CommunityStreamManager` routes by `TargetPlayerId` and only writes to connections this gateway holds. `GameHub.GetCommunityModeTicket` issues a ticket to a signed-in player; `POST /api/dev/mode-session` (Development only) issues tickets for throwaway players.
- **Silo role** Community matches use `CommunitySiloPlacement`; the director in the Silo host only picks silos whose metadata has the community role. `Silo:Roles` sets it (`game`, `community`, or both). A local single silo gets both; a clustered silo defaults to `game` and must opt in.
- **Dev kit** `devkit dev <mode> --remote` and `shell/transport-signalr.js`.
- Both projects are in the Silo and Gateway Dockerfiles. `tests/BlockBrawl.IntegrationTests` compiles again (it referenced the ambiguous `Program`).

### Running it locally

```bash
make deps-up
# Silo
DOTNET_ENVIRONMENT=Development CommunityModes__Enabled=true CommunityModes__PackagesPath=community/modes dotnet run --project src/Apps/BlockBrawl.Silo
# Gateway
ASPNETCORE_ENVIRONMENT=Development CommunityModes__Enabled=true dotnet run --project src/Apps/BlockBrawl.Gateway
# Dev kit against them
cd community && node devkit/cli.js dev duel-lite --remote
```

Configuration, all under `CommunityModes`: `Enabled`, `PackagesPath`, `ApprovedHashes`, `RequireApprovedHash`, `DisabledModes` (silo); `Enabled`, `TicketSigningKey` (at least 32 bytes, required outside Development), `TicketLifetimeMinutes` (gateway).

### Verified on 2026-11-12

Against a real Silo and Gateway with `duel-lite`, by script and in the browser through `devkit dev --remote`:

- Two players join, the match starts, both get a sync, moves are acknowledged and appear on both boards, illegal moves are rejected with the mode's reason.
- A player disconnects, the other moves, the first reconnects and is caught up.
- The Silo process is killed mid-match and started again: both players are resynced automatically with the same sequence number and the same state, and the match continues. Up to 10 seconds of clock (the snapshot interval) is lost.

## Done: backend before the Unity embedding (2026-11-13)

- **Start timeout.** `CommunityModes:StartTimeoutSeconds` (default 60). A match whose expected players do not all arrive is aborted for those who did, and a player who leaves before the start aborts it at once.
- **Finished matches can be re-read.** The completed (or aborted) record stays in the store. A participant who reconnects after the grain deactivated gets the final board and the result; anyone else is refused; a finished match is never started over. Before this, a late join to a finished match id would have started a fresh match.
- **Contracts project.** `BlockBrawl.Modules.CommunityModes.Contracts` holds the grain interface and messages; the Gateway references only it and no longer ships ClearScript.
- **Silo roles in both directions.** `SiloRoles` (Silo host) makes every grain without its own placement avoid silos that lack the game role, so a community silo hosts community matches only.
- **Deployment.** The Silo image builds `community/modes` into `/app/community-modes` and requires approved hashes, read from `community/modes/approved.json` (`CommunityModes:ApprovedHashesFile`). `devkit build` prints the hash and is now reproducible from any folder (`absWorkingDir`); `.gitattributes` pins LF for `community/`. `docker-compose.prod.yml` has an opt-in `silo-community` service (`--profile community`) with a 512 MB memory limit, `Silo:Roles=game` on the main silo, and the gateway's `CommunityModes__*` settings; `.env.prod.example` lists the two new variables.
- **Watchdog fix in `ScriptSandbox`.** The per-call timer can fire slightly before the Stopwatch deadline; the watchdog then returned without re-arming and an endless script ran forever, holding the grain's thread. It now re-arms for the remaining time. `InfiniteLoop_IsAlwaysInterrupted_EvenWhenTheTimerFiresEarly` reproduces the hang without the fix.
- **Tests: 73 in about 20 s** (fast suite). New cluster tests run the real `CommunityHub`, `CommunityStreamManager`, grain, placement directors and V8 on an in-process two-silo cluster (game + community) with `InMemoryCommunityMatchStore`: placement, acks and rejections, forfeit to result, re-reading a finished match after deactivation, start timeout, leaving before the start, reactivation with gateway resync, game grains staying off the community silo, and `stack-race` ticking on the server and played to its end.

Not verified here: the Docker image build (no Docker daemon in the environment where this was done; the `modes` stage's commands were run by hand against a clean copy and produced the approved hashes), and a manual run against Postgres and Redis.

### Known gaps

- **Messages travel as JSON text**, not MessagePack as the plan intended. It keeps the browser shell free of a MessagePack dependency; revisit if bandwidth matters.
- **The silo reads mode packages once, at start.** Updating a mode means a new image (or a new mounted folder) and a restart of `silo-community`. `ModeRegistry.Reload` exists but nothing calls it.
- **Any signed-in player can get a ticket for any match id** (`GameHub.GetCommunityModeTicket`). Fine while match ids are random and only handed out by the client; the catalog / matchmaking milestone should issue tickets for matches it created.
- **Finished match records are kept forever.** They are small (final state plus result), but a retention job will be needed eventually.
- **More than one gateway** is designed for (each gateway writes only to its own connections) but not tested.

### Local environment notes

- On the machine used for verification, another project's Postgres container owned port 5432, and StackExchange.Redis could not connect to `localhost:6379` (IPv6 loopback) while `127.0.0.1:6379` worked. Both are overridable: `ConnectionStrings__Postgres` and `ConnectionStrings__Redis`.

## Next

Later items from the plan: public repo with CI and publishing, catalog / rooms / matchmaking / bots / capped rewards, Unity embedding. Before those, the risks listed in `plan.md` (Apple guideline 4.7, webview performance on a cheap Android device, review load).

## Setting up on another machine

```bash
git fetch origin
git switch feature/community-modes
cd community
npm install
npm test
node devkit/cli.js dev duel-lite
```
