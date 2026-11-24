# __MODE_NAME__

Made from the `turn` template of the BlockBrawl community modes SDK: players take turns adding 1, 2 or 3 to a
shared total, and whoever brings it to 21 wins.

| File | What it is |
|---|---|
| `mode.json` | Name, version, player counts and the store listing |
| `server.js` | The rules: the only authority, runs on the server |
| `shared.js` | Rules the server and the client both use |
| `client/model.js` | The client's picture of the match, built from steps |
| `client/index.html` | What the player sees and taps |
| `tests/fuzz.js` | Plausible moves, so `test` and `bench` can play random matches |

```bash
npx brawl-modes dev __MODE_ID__     # play it in the browser, every player side by side
npx brawl-modes check __MODE_ID__   # everything review checks; must print READY TO SUBMIT
```
