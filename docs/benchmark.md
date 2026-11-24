# Benchmark: will the server accept my mode?

`brawl-modes bench <mode>` tells you, before you submit, whether your mode fits the server's performance budget.
The review server runs the same command with the same numbers, so **a mode that passes `bench` locally passes it
in review**. `brawl-modes check <mode>` runs it together with every other check review runs.

```bash
npx brawl-modes bench my-mode
npx brawl-modes bench my-mode --json   # one JSON object on stdout, for scripts and agents
```

## Why work units and not milliseconds

Milliseconds depend on the machine: the same mode is twice as fast on a fast laptop as on a slow one, so a
time-based limit would pass on your machine and fail on the server. The bench counts **work units** instead.
They depend only on your code and the match being played, so they are **identical on every machine**. The kit's
CI checks this on every change: the example modes must produce exactly the numbers in
`scripts/bench-baseline.json`.

The cost of one server call is:

| Part | Counts | Why |
|---|---|---|
| Code | 1 unit per function call and per loop pass in your server code | How much your code does |
| Data | `workPerByte` (10) units per byte of steps you emit and of the action your client sent | Every step is serialized, sent to every player and parsed again; data is usually most of the real cost |

The platform's fixed cost per call (crossing into the sandbox) is not counted: you cannot change it, and the
one 50 ms clock and the action rate limit already bound it, and a sleeping mode is not called at all.

## The two gates (`runtime/limits.json`)

| Gate | Limit | Measures |
|---|---|---|
| `maxWorkPerCall` | 1,000,000 | The single most expensive call (`setup`, `onAction`, `onTick`, `onPlayerStatus`, `sync`) |
| `maxWorkPerSecond` | 500,000 | One match's sustained cost: tick cost per second of match time, plus every player sending actions at the server's rate limit (`maxActionsPerSecond`, 30) at the 95th percentile action cost |

The second gate assumes the worst a client is allowed to do (30 actions a second from every player), because the
server cannot know your players are polite.

For scale, on a typical server core one unit of code is about 5 ns, so the per-call limit is about 5 ms of code,
and the per-second limit is roughly 50 KB of steps per second, or about 2.5 ms of code per second, per match.
The examples:

| Mode | Most expensive call | Units per match-second |
|---|---|---|
| tile-frenzy (8 players, 30 ticks/s) | 9,369 | 245,630 |
| duel-lite | 4,510 | 205,064 |
| stack-race | 5,545 | 165,364 |
| bloom-blocks | 4,671 | 137,744 |
| trail-clash | 37,221 | 75,697 |
| tap-rush (offline) | none | none |

## How it is measured

1. The bench plays the same seeded matches as `brawl-modes test` (your `nextAction` plus garbage input, at the
   most and the fewest players), 10 runs by default.
2. Each match is replayed in a sandbox running an instrumented copy of your server bundle that counts units. The
   counter lives outside your code: you cannot read or reset it.
3. The replay must produce exactly the same output as the original run. If it does not, the bench fails: a mode
   that behaves differently when it is measured would make the numbers meaningless.
4. One `sync` per player is added at the end, as a join or reconnect would cost.

## Reading the report

```
  call      count      mean      p95      p99      max
  tick      18190       392      973      983     1366
  action    17311       737      974      974      974
  sync         45      8678     9369     9369     9369

  ok    most expensive call: 9369 units (limit 1000000)
  ok    sustained cost: 245630 units per match-second (limit 500000)
        = ticks 11870/s + 8 players × 30 actions/s × 974 (p95 action)
  Of all cost: 7% code, 93% data
```

To see a failure, run `npx brawl-modes bench broken-heavy`: that fixture recounts a 150 × 150 grid on every
action instead of keeping a running total, and comes out at about 1.4 million units per match-second.

When you are over budget, the breakdown says where to look:

- **Ticks per second is large**: sleep when nothing moves (`ctx.sleepUntil`, `ctx.sleep`), do less per tick, or only
  emit steps for what changed.
- **The action term is large**: make actions cheaper, or reject invalid actions early (rejection is cheap).
- **Data dominates**: send smaller steps (ids instead of whole objects, deltas instead of full state). `sync`
  is the one place to send everything.
- **One call is huge**: spread work over several ticks instead of doing it all at once.

## Limits of the measure

Work done inside built-in functions without a callback (a long `indexOf`, a huge `JSON.stringify`, building a
long string) costs real time but no code units. State size and step batch size have their own limits
(`maxStateBytes`, `maxBatchBytes`), and the server keeps a hard per-call time limit (`maxCallMs`, 250 ms) as a
last line of defence, so such code is caught, just not by the bench. Write plain loops over plain data and the
bench sees everything.
