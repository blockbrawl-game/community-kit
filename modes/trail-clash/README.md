# Trail Clash

Steer a light trail through the arena and make everyone else crash first; the walls close in after 45 seconds.

**What it teaches**

- **Queued input.** A turn is queued on the server (at most two ahead, `reject('too_fast')` beyond that) and applied on
  the next tick, so fast taps are neither lost nor abused.
- **Prediction plus interpolation.** The client predicts its own turns (`pending`) and interpolates every head toward
  its next cell, so trails that move 6-10 cells a second look smooth.
- **Growing state, constant steps.** Trails get longer all match, but a move step (`{ t: 'mv', d: [...] }`) carries
  only each player's direction; clients extend the trails themselves, and only `sync` sends whole trails.
- **The most expensive example call.** Its `sync` is the largest call of the examples; `bench` shows why it is
  still far inside the gate.

| | |
|---|---|
| Players | 1-4 |
| Ticks | every 50 ms slot (a cell every 150 ms, 100 ms after 25 s) |

```bash
npx brawl-modes dev trail-clash --players 2
npx brawl-modes check trail-clash
```
