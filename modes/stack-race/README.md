# Stack Race

Real-time falling bars, one well per player, 1 to 4 players. The reference for ticking and client prediction.

**What it teaches**

- **The tick drives the world.** `onTick` drops every piece on a timer measured in `dtMs`; actions only move or drop the local piece.
- **Client prediction.** `client/model.js` keeps `auth` (what the server confirmed) and `pending` (actions sent but not
  acknowledged yet) and draws `auth` with `pending` replayed on top. An acknowledgement (`ackActionId`) or a rejection
  removes the action from `pending`, and the picture corrects itself. See `docs/prediction.md`.
- **`snapshot()` excludes predictions.** It returns only the confirmed picture, so `test` can compare clients.
- **Per-player boards in one state.** Steps carry the player index, so every client can draw every well.

| | |
|---|---|
| Players | 1-4 |
| Ticks | asleep until the next piece falls (every 500 ms, speeding up to 200 ms) |

```bash
npx brawl-modes dev stack-race --players 2
npx brawl-modes check stack-race
```
