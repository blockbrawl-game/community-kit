# Prediction

In a turn-based mode the client can simply wait for the server: send the action, and draw the result when the step arrives. Duel Lite does this.

In a fast-paced mode a round trip of 100 ms makes controls feel heavy. The fix is **prediction**: show the player's own action immediately and correct it if the server disagrees. Prediction is the mode's job. The platform gives you three things to build it with:

1. `game.send(action)` returns an `actionId`.
2. The step batch produced by that action carries `ackActionId`. A refused action triggers `onRejected(actionId, reason)`.
3. `shared.js` is bundled into both halves, so the client can run the exact rule the server will run.

## The pattern

Keep two things apart in the client model:

- **`auth`**: what the server confirmed. Only steps change it.
- **`pending`**: actions that were sent and not yet acknowledged.

What you draw is `auth` with `pending` replayed on top.

```js
// on input
const actionId = game.send(action);
model.predict(actionId, action);          // pending.push({ actionId, action })

// in applySteps
for (const step of batch.steps) apply(step);                 // changes auth only
if (batch.ackActionId !== undefined) dropPendingUpTo(batch.ackActionId);

// in onRejected
pending = pending.filter((entry) => entry.actionId !== actionId);

// when drawing
let piece = { ...auth.piece };
for (const { action } of pending) piece = applyWithSharedRules(piece, action);
```

There is no rollback code. Because the drawn picture is always recomputed from `auth` plus `pending`, a rejected or reordered action corrects itself on the next frame.

`modes/stack-race/client/model.js` is the complete example.

## Guidelines

- **Predict only what the player controls.** In Stack Race the client predicts moves and the drop position. It does not predict the next piece, because that comes from the server's random generator.
- **`snapshot()` returns `auth` only.** Predictions are not part of the confirmed model.
- **Check locally before sending.** If the shared rule says a move is blocked, do not send it.
- **Stop replaying at an action whose outcome you cannot know.** Stack Race stops at a drop: actions after it apply to a piece the client has not been told about yet.
- **Try it with latency.** Set the latency slider in `devkit dev` to 200 ms and the drop slider to 10%. The mode should still feel responsive and never end up in a wrong state.
