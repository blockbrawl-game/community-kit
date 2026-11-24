# Duel Lite

Two players take turns placing block pieces on a shared board. The smallest complete online mode: read it first.

**What it teaches**

- **Hidden information.** Each player's hand goes only to its owner with `ctx.emit({ t: 'hand', ... }, { to: playerId })`,
  and `sync(state, playerId)` sends only that player's hand.
- **Validate, then mutate.** `onAction` runs every `reject(...)` check (`not_your_turn`, `bad_piece`, `blocked`)
  before it touches `state`.
- **A turn timer without ticking.** The mode sleeps until the deadline (`ctx.sleepUntil`), so it is ticked about once per turn; the client counts down with `game.timeMs()`.
- **Forfeits.** `onPlayerStatus` ends the match when a player leaves.
- **Seeded randomness.** New pieces come from `ctx.rng.pick`.

| | |
|---|---|
| Players | 2 |
| Ticks | asleep until the turn deadline |
| Files | `shared.js` (pieces, placement rules), `server.js`, `client/model.js`, `client/index.html`, `tests/fuzz.js` |

```bash
npx brawl-modes dev duel-lite
npx brawl-modes check duel-lite
```
