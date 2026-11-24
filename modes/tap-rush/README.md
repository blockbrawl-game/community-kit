# Tap Rush

Thirty seconds, a five by five board, one lit block at a time: tap it for a point, miss and lose one. The reference
offline mode.

**What it teaches**

- **An offline mode is only a client.** `mode.json` has `"runtime": "offline"` and no `server`, `clientModel` or
  `fuzz`. The whole game is `client/index.html`.
- **`connectOffline()`** from `@blockbrawl/mode-sdk/offline`: wait for `ready`, then report the end with
  `game.finish({ score })`. The score is shown but not verified, so it earns nothing.
- **`Math.random` is allowed here**, because there is no server match to replay.
- **A game loop with `requestAnimationFrame`.**

See `docs/offline-modes.md`.

```bash
npx brawl-modes dev tap-rush
npx brawl-modes check tap-rush
```
