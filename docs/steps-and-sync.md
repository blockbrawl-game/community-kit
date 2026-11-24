# Steps and sync

The server never sends its state. It sends **steps**: small facts about what changed. The client applies them to its model. This keeps bandwidth low, but it means the client is only correct if every change reaches it. This page is about getting that right.

## The one rule

> Every change to `state` that a client can observe must be carried by a step, and `sync` must describe the same state those steps add up to.

`brawl-modes test` checks this directly: it compares a client that saw every step with one that joined through `sync` at a random moment. If they differ, either a step is missing something or `sync` is.

## What the platform does for you

- Batches are numbered per player. If one is lost, the shell notices the gap, asks for a sync and hands the model a fresh `applySync`. You never see a broken stream.
- A joining or reconnecting player always starts with `applySync`.
- A batch caused by a player's own action carries `ackActionId`, and goes out at once.
- Everyone else's copy of those steps may wait for the next tick (at most 50 ms while the mode is awake) and arrive
  merged with other steps in one batch. A batch is a list of steps in order, so `applySteps` handles a merged one like
  any other. A mode that sleeps sends at once: nothing would come to merge with.

You only write `sync` on the server and `applySync` / `applySteps` on the client.

## Writing steps

Use a short type tag and short keys. Refer to players by index, not by id.

```js
ctx.emit({ t: 'place', p: 0, piece: 'l1', x: 3, y: 4, score: 12 });
```

**Send causes, not consequences.** Duel Lite sends where a piece was placed. The client recomputes which lines cleared using the same function from `shared.js` as the server. Sending the whole board would be ten times larger.

**Commit state together with its step.** A classic bug: the server advances `state.turn`, then decides the match is over and never emits the `turn` step. A live client still shows the old turn, a synced client shows the new one. Work on local variables and write them to `state` at the point where the step is emitted. See `advanceTurn` in `modes/duel-lite/server.js`.

**Private information** goes to one player:

```js
ctx.emit({ t: 'hand', hand }, { to: playerId });
ctx.emit({ t: 'refill', p });            // everyone learns that it happened, not what was dealt
```

## Writing sync

`sync(state, playerId)` returns steps that rebuild that player's view from nothing. Usually that is one big `state` step plus anything private to the player.

```js
sync(state, playerId) {
  return [
    { t: 'state', board: state.board.join(''), turn: state.turn, scores: [...] },
    { t: 'hand', hand: state.hands[playerId] },
  ];
}
```

Keep one `apply(step)` function in the client model and use it for both sync and live steps. Then there is only one place where a step type is interpreted.

## Checklist

- [ ] Every `state` mutation in `onAction`, `onTick` and `onPlayerStatus` has a step next to it.
- [ ] `sync` includes every field the client model keeps.
- [ ] `snapshot()` returns everything the model derived from steps, and nothing predicted locally.
- [ ] `brawl-modes test` passes.
