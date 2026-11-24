# Tile Frenzy

Up to 8 players race to grab glowing tiles on a shared board, at 30 ticks a second. The stress test: the most
players and the highest tick rate the platform allows.

**What it teaches**

- **Scaling to 8 players.** Every step is tiny (a tile index and a value), so 8 players at 30 actions a second stay
  inside the bench's per-second gate. Run `npx brawl-modes bench tile-frenzy` and look at the data share.
- **Contested actions.** Two players can tap the same tile; the server decides, and the slower one gets
  `reject('gone')`. Rejection is cheap and normal.
- **Optimistic grabs.** The client hides a tapped tile at once and brings it back if the grab is rejected.
- **Randomness in the tick.** Spawns, golden tiles and bombs come from `ctx.rng` in `onTick`.

| | |
|---|---|
| Players | 1-8 |
| Tick rate | 30 (the maximum) |

```bash
npx brawl-modes dev tile-frenzy --players 4
npx brawl-modes bench tile-frenzy
```
