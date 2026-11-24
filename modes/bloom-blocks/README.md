# Bloom Blocks

Plant shapes on a 9 x 9 garden; full rows and columns burst into bloom. Alone, or taking turns with a friend.

**What it teaches**

- **A rich client on a simple server.** Drag and drop, glow, particles and eased animation all live in
  `client/index.html`; the server only checks that a shape fits and clears lines.
- **Visual effects without `Math.random`.** The client's particles use a small seeded generator, because the source
  policy rejects `Math.random` in every file of an online mode.
- **One placement in flight.** The model keeps a single `pending` placement and draws it until the server answers.
- **Solo and versus in one mode.** `players: { min: 1, max: 2 }`; the turn logic simply skips when there is one player.

| | |
|---|---|
| Players | 1-2 |
| Tick rate | 2 (turn timer) |

```bash
npx brawl-modes dev bloom-blocks
npx brawl-modes check bloom-blocks
```
