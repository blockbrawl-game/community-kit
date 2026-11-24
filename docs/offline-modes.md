# Offline modes

An offline mode is only a client: one HTML document that runs in the game's sandboxed frame, with no server code
and no match. Use it for single-player toys, practice games and experiments.

| | Online mode | Offline mode |
|---|---|---|
| Server code | `server.js`, the authority | none |
| Players | 1-8, real multiplayer | 1 |
| Result | verified by the server, can earn rewards | shown, not verified, earns nothing |
| `Math.random` | rejected (use `ctx.rng`) | allowed |
| `check` runs | policy, test, bench, build | policy, client size, build |
| Network | none | none |

## mode.json

```json
{
  "$schema": "../../node_modules/@blockbrawl-game/community-kit/schema/mode.schema.json",
  "id": "tap-fast",
  "name": "Tap Fast",
  "version": "1.0.0",
  "sdk": "0.1",
  "runtime": "offline",
  "players": { "min": 1, "max": 1 },
  "orientation": "portrait",
  "client": "client/index.html"
}
```

`runtime` must be `"offline"`. `server`, `clientModel` and `fuzz` must be left out.

## The client

```html
<script type="module">
import { connectOffline } from '@blockbrawl/mode-sdk/offline';

const game = connectOffline({
  onReady(game) {
    // game.me is this player's id, game.players the player list
  },
});

// ... the game ...
game.finish({ score: 42 }); // the host shows the result
game.exit();                // asks the host to close the mode (a "back" button)
</script>
```

| Member | Meaning |
|---|---|
| `connectOffline({ onReady? })` | Connects to the host shell; `onReady(game)` runs once the host has said who is playing |
| `game.ready`, `game.me`, `game.players` | Set when the host is ready |
| `game.finish({ score })` | Reports the end of a run. Call it again after a replay |
| `game.exit()` | Asks the host to close the mode |

The same rules as for every client apply: no network, everything imported from the mode folder (images, sounds and
CSS become part of the one built document), and at most 5 MB once built.

## Start one

```bash
npx brawl-modes new tap-fast --offline
npx brawl-modes dev tap-fast
npx brawl-modes check tap-fast
```

The `offline` template is a ten-second tap challenge. The example `tap-rush` is a complete one with a game loop.
