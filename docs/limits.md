# Limits and testing

## The server sandbox

Server logic runs in a V8 isolate with nothing but the JavaScript language:

- No network, files, timers, `eval` or `new Function`.
- No typed arrays, `ArrayBuffer`, `DataView` or WebAssembly. Use plain arrays; state is JSON anyway.
- `Math.random()` and `Date` are deterministic: a seeded generator and the match clock. Still, write `ctx.rng` and
  `ctx.timeMs`: the source policy rejects `Math.random` in server-side files (see below).
- Given the same seed and the same inputs, a mode must produce exactly the same steps.

## The client sandbox

The client runs in a sandboxed frame with an opaque origin and a content security policy that blocks all network access. It can only exchange messages with the host shell. Scripts, styles and assets must be part of the mode package; the build turns them into one self-contained document.

There is no `'unsafe-eval'` and no storage (`localStorage` throws in an opaque origin). WebGL and the 2D canvas work.
For WebGL, use the kit's PixiJS build, `import { Application } from '@blockbrawl/mode-sdk/pixi'`, which works
under this policy; see [Rendering](rendering.md).

## Numbers

Defined in [`runtime/limits.json`](../runtime/limits.json).

| Limit | Value | What happens when exceeded |
| --- | --- | --- |
| Ticks | every 50 ms while awake, the same for every mode | (not a limit: see `ctx.sleepUntil`) |
| Time per call | 250 ms watchdog | match is aborted |
| Time per call, p99 | 5 ms | warning in `brawl-modes test` |
| State size | 256 KB | match is aborted |
| Steps per call | 256 | match is aborted |
| Step batch size | 16 KB, of which 128 bytes are kept for the envelope: one call's steps for one player must fit in 16,256 | match is aborted |
| Action size | 4 KB | action is rejected |
| Server bundle | 256 KB | fails `brawl-modes test` |
| Built client | 5 MB | fails `brawl-modes test` |

The 250 ms watchdog exists to stop infinite loops. It is not a performance target: a healthy mode answers in well under a millisecond.

## What `brawl-modes test` checks

| Check | What it proves |
| --- | --- |
| build | The mode bundles and fits the size budgets |
| fuzz | Random matches, including garbage actions, never make the mode throw; a rejected action leaves state untouched |
| sync | A client that joins through `sync()` equals one that saw every step |
| determinism | Replaying the recorded inputs gives identical output |
| hydration | The same replay still matches when the match is moved to a fresh sandbox, so nothing lives outside `state` |
| budgets | Call time, state size, batch size and bytes per second per player |

A failure prints the seed to reproduce it:

```bash
npx brawl-modes test my-mode --seed 7 --runs 1
```

Deliberately broken modes in `devkit/fixtures/` show what failures look like: `broken-sync` and `broken-hidden-state` fail `test`; `broken-heavy` passes `test` but is over budget in `bench`.

## Performance: `bench` and `check`

`test` reports call times on your machine for information. Whether the server accepts the mode's performance is
decided by `bench`, in work units that are the same on every machine: see [Benchmark](benchmark.md).
`check` runs `test`, `bench`, the source policy and `build` together, exactly as review does.

## The source policy

`check` also searches every `.js`, `.html`, `.css` and `.json` file of the mode (except under `tests/`) for these,
and fails on any match. There are two rule sets, because the two halves of a mode run in different places:

- **Server-side files** are the ones the `server` file or the `clientModel` file imports, directly or not
  (`server.js`, `shared.js`, `client/model.js` and what they import). They run in the server sandbox, or must
  replay identically in `test`, so every rule applies.
- **Client files** are the rest of the client: rendering, input, effects. Only the first three rules apply; typed
  arrays (WebGL needs them) and `Math.random` (for visual effects) are fine there.

| Not allowed | Where | Why |
|---|---|---|
| `eval(`, `new Function(`, dynamic `import(` | everywhere | Code must be what review read |
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` | everywhere | Modes have no network |
| `Worker`, `SharedWorker`, `ServiceWorker` | everywhere | Not available in the frame |
| `ArrayBuffer`, `SharedArrayBuffer`, typed arrays, `DataView` | server-side files | Removed in the server runtime |
| `WeakRef`, `FinalizationRegistry` | server-side files | They reveal garbage collection timing, which is not deterministic; removed in the server runtime |
| `Math.random` | server-side files of online modes | Replays must be identical; use `ctx.rng` |

An offline mode has no server side: its whole client follows the client rules. When the server bundle or the client
model does not build, every file gets every rule (and `build` reports the error). The kit's own files
(`@blockbrawl/mode-sdk/...`, including the PixiJS build) are not searched.

It is a plain text search, so it also matches those words in comments and strings. Rephrase them ("download"
instead of "fetch" in a description, for example). The rules are in
[`devkit/policy.js`](../devkit/policy.js).
