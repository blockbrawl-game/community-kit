# __MODE_NAME__

Made from the `offline` template of the BlockBrawl community modes SDK: a ten-second tap challenge. An offline
mode has no server code at all: the whole game is `client/index.html`, it never touches the network, and its
score is shown but not verified (it earns nothing in the game).

| File | What it is |
|---|---|
| `mode.json` | Name, version and the store listing; `"runtime": "offline"` |
| `client/index.html` | The whole game |

```bash
npx brawl-modes dev __MODE_ID__     # play it in the browser
npx brawl-modes check __MODE_ID__   # everything review checks; must print READY TO SUBMIT
```

See `docs/offline-modes.md` in the SDK for what an offline mode can and cannot do.
