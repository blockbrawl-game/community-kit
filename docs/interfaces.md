# Interfaces

The full typed definitions are in [`sdk/types.d.ts`](../sdk/types.d.ts). This page explains what each part is for.

## mode.json

```json
{
  "id": "duel-lite",
  "name": "Duel Lite",
  "version": "1.0.0",
  "players": { "min": 2, "max": 2 },
  "tickRate": 2,
  "server": "server.js",
  "client": "client/index.html",
  "clientModel": "client/model.js",
  "fuzz": "tests/fuzz.js"
}
```

- `id` must equal the folder name.
- `tickRate` is how often `onTick` runs. Use `0` for no ticking. The maximum is 30.
  Every match runs on one 50 ms grid (20 slots a second), so the rate is rounded to whole slots: `onTick` runs every
  `round(20 / tickRate)` slots, and `dtMs` is always a multiple of 50. 2 runs every 500 ms, 10 every 100 ms, and
  anything from 14 up every 50 ms (20 a second). Use `dtMs` and `ctx.timeMs` rather than counting ticks.
  If the server falls behind, the next tick carries the time that passed (at most 200 ms), never a burst of ticks.
  Actions arrive with their exact time between ticks, and a tick that is due always runs before the action.
- Every key, with its rules, is in [`schema/mode.schema.json`](../schema/mode.schema.json); add
  `"$schema": "<path to that file>"` for completion in your editor (`brawl-modes new` does). Unknown keys fail
  `check`. The store listing keys are in [listing.md](listing.md), offline modes in [offline-modes.md](offline-modes.md).

## Server: `defineMode`

```js
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';

export default defineMode({
  setup(ctx) {},                              // required: return the initial state
  onAction(state, action, ctx) {},            // required
  onTick(state, dtMs, ctx) {},                // optional
  onPlayerStatus(state, playerId, status, ctx) {},  // optional
  sync(state, playerId) {},                   // required: return an array of steps
  result(state) {},                           // required: null, or { ranking, scores }
});
```

Rules:

- **`state` is plain JSON and is the only place match data lives.** The platform saves and restores it. A module-level variable is lost when the match moves to another server.
- **`onAction` validates first, then mutates.** To refuse an action, `throw reject('reason')` before changing anything. Any other exception aborts the match.
- **`sync` is read-only.** It must not change state.
- **`result`** returns `null` while the match runs. `ranking` lists every player id once, first place first. Ties are a nested array: `[["a", "b"], "c"]`.

### `ctx`

| Member | Meaning |
| --- | --- |
| `players` | `[{ id, name, isBot }]`, in a fixed order |
| `playerId` | the acting player in `onAction` and `onPlayerStatus`, otherwise `null` |
| `rng` | seeded random: `next()`, `int(n)`, `pick(array)`, `shuffle(array)` |
| `timeMs` | match clock in milliseconds |
| `emit(step)` | send a step to every player |
| `emit(step, { to: playerId })` | send a step to one player only |
| `log(...)` | debug output, shown in the dev kit |

Use `ctx.rng` for every random choice and `ctx.timeMs` for time. The sandbox replaces `Math.random()` and `Date` with the same seeded generator and the match clock, but the source policy that review runs rejects `Math.random` anywhere in an online mode (server and client), so a mode that uses it does not pass `check`. For visual-only randomness in a client, use a small seeded generator of your own. There are no timers and no network.

## Client model: `createModel`

The model is the client's picture of the match. It has no DOM access so that the dev kit can run it without a browser.

```js
export function createModel() {
  return {
    applySync(steps, info) {},   // required: reset and rebuild
    applySteps(batch) {},        // required: batch.steps, batch.ackActionId
    onRejected(actionId, reason) {},  // optional
    snapshot() {},               // required: the server-confirmed model as plain JSON
  };
}
```

## Client page: `connect`

```js
import { connect } from '@blockbrawl/mode-sdk/client';
import { createModel } from './model.js';

const model = createModel();
const game = connect({
  model,
  onChange(batch) { render(); },
  onRejected(actionId, reason) {},
  onResult(result) {},
});

game.send({ t: 'place', x: 3, y: 4 });   // returns an actionId
game.timeMs();                            // estimated match clock
game.me;                                  // this player's id
game.players;
```

The client page is built into one self-contained document. Everything it needs must be in the mode folder: import scripts and assets relatively (`import pic from './tile.png'` gives a data URI). External URLs are refused.

## Fuzz: `nextAction`

```js
export function nextAction(model, playerId, rng) {
  // return a plausible action for this player, or null to do nothing this turn
}
```

`brawl-modes test` uses this to play random matches. It receives the client model, so it only knows what a real player would know.
