# The store listing

What players see before they open your mode comes from `mode.json` and one image in the mode folder. `check`
validates all of it.

| Key | Rules | Shown as |
|---|---|---|
| `name` | required | The title |
| `tagline` | at most 80 characters | The line on the store card |
| `description` | at most 2000 characters | The mode's page |
| `tags` | at most 8; 2-20 chars each, lowercase letters, digits, dashes | Store filters |
| `author` | free text | "by ..." |
| `players` | `{ min, max }`, 1 <= min <= max <= 8 | Player count |
| `orientation` | `portrait`, `landscape` or `any` | Which way to hold the phone |
| `runtime` | `online` (default) or `offline` | Offline results are not verified and earn nothing |

## Thumbnail

Put `thumb.webp`, `thumb.png` or `thumb.jpg` in the mode folder (looked for in that order).

- 640 x 360 pixels (16:9), so it is sharp on the store card.
- At most 512 KB; the store ignores a larger file, and `check` fails on it.
- Show the game being played, not a logo on a plain background.

## Good listings

- A tagline says what you do: "Race to the coin. First to five wins." is better than "A fun game".
- The description says how to play, how a match ends and how long it takes.
- Tags describe the play: `turn-based`, `real-time`, `party`, `puzzle`, `solo`, `versus`, `reflex`.

## Versions

Every change you submit needs a higher `version` (semver). The server approves one exact build per
`id@version`, so an unchanged version with changed code is refused. Never change `id` after the first release: it
identifies the mode everywhere, and a new id is a new mode.
