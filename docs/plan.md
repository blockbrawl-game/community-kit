# Community Game Modes (HTML5/JS) for BlockBrawl — Milestones 1–3

## Context

The goal is to let outside developers write custom BlockBrawl game modes in HTML5/JS, submit them to a public repository, and have reviewed modes run inside the live game. The native Unity game stays as it is. A community mode renders in a webview and its authoritative logic runs server-side in a V8 sandbox inside the existing Orleans stack. Everything before the final Unity embedding must be buildable and testable in a browser.

The backend already has the right seam. `BaseGameSessionGrain<TState, TAction, TResult, TEvent>` (`src/Platform/BrawlPlatform.Core.Engine/Grains/BaseGameSessionGrain.cs`) owns lifecycle, ready/countdown, ticking, disconnect grace, snapshots and stream broadcast, and delegates all rules to `IGameLogic<…>` (`Abstractions/IGameLogic.cs`). `MatchGrain` + `BlockBrawlGameLogic` are one implementation; a community mode is a second one whose `IGameLogic` forwards to JavaScript.

What cannot be reused is the wire format: `IGameEvent`, `IMatchActionBody` and `GameStep` are closed MessagePack unions in `src/Shared`, mirrored into Unity. Community modes get their own messages, stream namespace and hub, so the shared/Unity contract is untouched.

**Decisions taken**
- **Event stream sync**, same pattern as the main game: the server emits ordered steps, the client rebuilds from them, and catch-up is an explicit sync. Chosen for bandwidth. Consistency comes from mandatory interfaces plus a reference demo and docs.
- **Turn-based is the main target; fast-paced modes must be possible.** Client prediction is the mode author's job; the platform only provides what makes it possible (action acks, shared code, configurable tick rate).
- **ClearScript V8, one isolate per match, in a dedicated silo role.**
- **Scope: milestones 1–3.** SDK, dev kit and modes start in `community/` in this repo and move to the public repo once the contract settles.

## Architecture

```
 mode package                          server (this repo)
 ┌──────────────────────┐             ┌────────────────────────────────────┐
 │ mode.json            │             │ ModeRegistry (id + version + hash) │
 │ server.js  (logic)   │ ──────────▶ │ CommunityMatchGrain                │
 │ shared.js  (optional)│             │   └ JsGameLogic ─▶ V8 isolate      │
 │ client/    (HTML5)   │             │ Gateway /modehub                   │
 └──────────────────────┘             └────────────────────────────────────┘
 browser / webview
 ┌──────────────────────────────────────────────┐
 │ host shell (ours, trusted, holds connection) │
 │   └ sandboxed iframe: mode client (untrusted)│  ◀─ postMessage only
 └──────────────────────────────────────────────┘
```

### Mode package

`community/modes/<mode-id>/`:
- `mode.json` — id, name, version, sdk version, min/max players, `tickRate` (0 = no tick, capped at 30), orientation, author.
- `server.js` — entry module; may import `shared.js`. The dev kit bundles it to a single script for V8.
- `client/` — static HTML5 app with a size budget.

### Mandatory interfaces (`community/sdk`)

Server (`ModeServer`), pure functions over a JSON-serializable state that the platform owns:

```js
export default defineMode({
  setup(ctx)                               // -> initial state; may emit opening steps
  onAction(state, action, ctx)             // validate + mutate + ctx.emit(step); throw reject(reason) if illegal
  onTick(state, dtMs, ctx)                 // only if tickRate > 0
  onPlayerStatus(state, playerId, status, ctx)   // disconnected / reconnected / forfeited
  sync(state, playerId)                    // -> steps that rebuild this player's full view (join + reconnect)
  result(state)                            // null, or { ranking, scores }
});
// ctx: players, playerId, rng (seeded), timeMs (match clock), emit(step, { to? }), log
```

Client (`ModeClient`), inside the sandboxed iframe:

```js
connect({
  applySync(steps, info)      // reset local model and rebuild from sync steps
  applySteps(batch)           // ordered steps; batch.ackActionId set for the sender's own action
  onRejected(actionId, reason)
  onResult(result)
  snapshot()                  // canonical client model, used only by the consistency test
});
game.send(action)             // returns actionId, for prediction and reconciliation
```

Platform responsibilities, so authors do not reimplement them:
- **Step batches** carry a per-recipient sequence number. The shell detects gaps and automatically requests a sync; authors only write `sync` and `applySync`.
- **Per-player steps** via `emit(step, { to })` for hidden information.
- **Determinism**: `Math.random` and `Date` are replaced with seeded / match-clock versions; no timers, no I/O. Same seed + same actions ⇒ same steps and same state.
- **JSON state** is what gets snapshotted and hydrated. Modes hold no state outside it.
- **Encoding**: steps are JSON at the mode boundary. In milestone 3 the hub transports them MessagePack-encoded (`MessagePackSerializer.ConvertFromJson` server-side, decoded in the shell), invisible to mode code.

### Server runtime

**New `src/Platform/BrawlPlatform.Core.Scripting`** (game-agnostic, no Orleans dependency)
- `ScriptSandbox` on `Microsoft.ClearScript.V8`: one isolate per instance, no host objects exposed, a frozen prelude that installs the deterministic globals and the `ctx` plumbing, compiled-script cache per mode version.
- Limits (`ScriptSandboxLimits`): max heap with interrupt-on-violation, per-call CPU watchdog using `Interrupt()`, max state bytes, max steps and bytes per call. A violation raises `ScriptLimitExceededException`.

**New `src/Modules/BlockBrawl.Modules.CommunityModes`**
- `Contracts/` — `ICommunityMatchGrain`, `CommunityActionMessage { ClientActionId, Json }`, `CommunityMatchEvent { TargetPlayerId?, Kind, Seq, AckActionId?, Payload }` (all `[GenerateSerializer]`), `ModeManifest`.
- `Grains/CommunityMatchGrain.cs` — `BaseGameSessionGrain<CommunityMatch, CommunityActionMessage, bool, CommunityMatchEvent>`, `[GrainType("blockbrawl.communitymatch")]`, `StreamNamespace => "CommunityMatch"`, `Config.TickInterval` / min / max players from the manifest, disposes the sandbox in `OnDeactivateAsync`, aborts the match on a limit violation.
- `Logic/JsGameLogic.cs` — `IGameLogic` mapping: `InitializeAsync→setup`, `ValidateActionAsync` (payload size, rate limit), `ExecuteActionAsync→onAction`, `TickAsync→onTick`, `CheckCompletion→result`, `GenerateCatchUpEvent→sync`. `CommunityMatch` is the live object holding the sandbox, pinned mode version and current state JSON, mirroring how `Match` is used today.
- `Persistence/CommunityMatchSnapshotStore.cs` — `ISessionSnapshotStore<CommunityMatch>` on Marten, same session pattern as `BlockBrawlMatchSnapshotStore`; stores mode id, pinned version, seed, state JSON. Hydration recreates the sandbox and loads the state.
- `Services/ModeRegistry.cs` — loads packages from `CommunityModes:PackagesPath` (points at `community/modes` in dev), verifies content hash, exposes a per-mode kill switch.

**Gateway (`src/Apps/BlockBrawl.Gateway`)**
- `Hubs/CommunityHub.cs` at `/modehub`: `Join`, `SendAction`, `RequestSync`, `Leave`. Authenticated by a second JWT scheme, a short-lived match-scoped ticket (claims: player, match, mode). Kept thin per the repo's hub rules.
- `Services/CommunityStreamManager.cs`, modelled on `GatewayStreamManager`: subscribes to `CommunityMatch/<matchId>` and routes to the match group, or to one player's connection when `TargetPlayerId` is set.
- `Hubs/GameHub.Community.cs`: one thin method that issues a ticket for the authenticated player.
- Development-only `POST /api/dev/mode-session` that issues a ticket for a throwaway player, so browsers can test without Firebase.

**Silo (`src/Apps/BlockBrawl.Silo/Program.cs`)**
- Register the module's services behind `CommunityModes:Enabled`.
- Dedicated role: a placement filter on silo metadata (`role=community`) so `CommunityMatchGrain` only activates on community silos, with the same image running either role by environment variable. Local dev runs one silo with both roles. The exact Orleans 10 placement API is to be confirmed during implementation.
- Add the two new projects to `BlockBrawl.slnx` and to the Silo and Gateway Dockerfiles.

### Client shell (`community/shell`)

A small trusted page that holds the `/modehub` connection, loads the mode in `<iframe sandbox="allow-scripts">` (opaque origin, CSP with no network access), relays over `postMessage`, tracks sequence numbers and triggers sync on gaps. The mode code never sees a token. The same shell is used by the dev kit, later by the WebGL build (iframe over the canvas) and by a native webview.

### Dev kit (`community/devkit`, Node)

- `devkit dev <mode>` — runs `server.js` in-process with the same prelude, opens N players side by side in the shell, with latency / drop sliders, a step log and a state inspector.
- `devkit dev <mode> --remote` — same shell against the real local gateway and V8 runtime.
- `devkit test <mode>`:
  - **Determinism**: same seed and action log twice ⇒ identical step stream and state hash.
  - **Sync consistency**: during a fuzzed match, a second client joins through `sync` at random points; its `snapshot()` must equal the live client's. This is the check that makes the event-stream model safe.
  - **Fuzz**: random legal and illegal actions; no throws, no limit violations.
  - **Budgets**: per-call time p50/p99, state size, bytes per step batch, bundle size.
  - **Record**: writes an action log and expected hashes for replay in the .NET tests.
- `devkit build <mode>` — bundles `server.js` and the client.

### Reference modes and docs

- `community/modes/duel-lite` — turn-based block placement on a shared board. The canonical "how to structure steps and sync" example.
- `community/modes/stack-race` — real-time ticking mode with client prediction and reconciliation through `ackActionId`, with logic in `shared.js`. The best-practice demo for fast-paced modes.
- `community/docs/` — interface reference, step and sync guidelines, prediction guide, limits.

## Milestones

1. **Contract + dev kit, no backend.** `community/sdk`, `shell`, `devkit`, both reference modes, docs skeleton.
2. **V8 runtime in .NET.** `BrawlPlatform.Core.Scripting`, `JsGameLogic`, `ModeRegistry`, and `tests/BlockBrawl.CommunityModes.Tests`.
3. **Orleans + gateway.** Grain, snapshot store, `/modehub`, tickets, stream manager, silo role, `devkit --remote`.

Later, not in this plan: public repo with CI and publishing, catalog / rooms / matchmaking / bots / capped rewards, Unity embedding.

## Risks to check before the later milestones

- Apple guideline 4.7 conditions for HTML5 mini-games, and whether portals such as CrazyGames allow nested iframes.
- Webview performance on a cheap Android device against the dev kit budgets.
- Review load from LLM-generated submissions; `devkit test` in CI has to filter most of it.

## Verification

- **Milestone 1**: `devkit dev duel-lite` and `stack-race` playable with two simulated players, including a forced reconnect. `devkit test` passes for both and fails on a deliberately broken mode (non-deterministic, and one with an incomplete `sync`).
- **Milestone 2**: `dotnet test tests/BlockBrawl.CommunityModes.Tests` — both modes run; an infinite loop is interrupted; a heap bomb is contained; an oversized state is rejected; action logs recorded by the dev kit replay to identical hashes in ClearScript.
- **Milestone 3**: `make deps-up`, run Silo and Gateway, `devkit dev duel-lite --remote` in two browser tabs. Play to completion; drop one tab mid-match and rejoin; restart the silo mid-match and confirm the match resumes from its snapshot. Existing fast unit suites still pass. `BlockBrawl.IntegrationTests` is run only with explicit confirmation, per `AGENTS.md`.
