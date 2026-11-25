# Rendering: PixiJS, performance and themes

A mode client is a web page in a sandboxed frame, so any rendering works: the DOM, the 2D canvas, WebGL. On a cheap
Android phone inside the game's webview, how you render decides whether the mode feels smooth and whether the phone
gets hot. This page is the advice that review applies when it plays your mode.

## PixiJS from the kit

The kit ships a build of [PixiJS](https://pixijs.com) 8.22 that works inside the mode frame (whose content security
policy has no `'unsafe-eval'`; the build includes `pixi.js/unsafe-eval`):

```js
import { Application, Container, Sprite, Texture } from '@blockbrawl/mode-sdk/pixi';
```

- It is bundled into your client like any import: about 910 KB of the 5 MB client budget. Import it once.
- It is the same file for every mode, built by the kit (`scripts/vendor-pixi.mjs`) and not searched by the source
  policy. Do not copy another Pixi build into your mode: it would be your code to review, and it would fail the
  policy (it contains network and worker code paths).
- Do not use `Assets.load` with URLs: the frame has no network. Make textures from canvases
  (`Texture.from(canvas)`) or from imported images (`import url from './tile.png'` gives a data URI).
- For editor types, add `pixi.js@8.22.0` as a dev dependency of your workspace.

The BlockBrawl modes in the game repository (`community/shared/blockbrawl/client/`) are a complete example: board,
drag and drop, particles, themes.

## Render only when something changes

The biggest saving, and the easiest to get wrong. A turn-based board is still most of the time; drawing it 60 times a
second anyway costs battery and heat, and the phone then slows the CPU down for everyone.

- Start the application with `autoStart: false` and stop its ticker. Draw a frame with `app.render()` when the
  model changes, and keep requesting frames (`requestAnimationFrame`) only while something moves: a tween, a
  particle, a drag.
- Ambient effects that never end (falling snow, a pulsing glow) cap their own frame rate, for example at 30.
- Timers and score counters are cheapest in the DOM, updated a few times a second; they need no canvas frame.

## Keep the GPU work small

- **Cap the resolution**: `resolution: Math.min(devicePixelRatio, 2)` and `autoDensity: true`. Phones at 3x draw
  more than twice the pixels for little visible gain.
- **Antialiasing off** (`antialias: false`) and draw smooth shapes into textures with the 2D canvas, which
  antialiases for free, once.
- **One texture atlas**: draw every tile, icon and particle into one canvas and cut frames from it (`new Texture({
  source, frame })`). Sprites from one source draw in one batch.
- **Static parts once**: a board backdrop with its grid is one texture, not 81 sprites redrawn every frame.
- **Pool particles**: create a fixed number of sprites up front and reuse them. A burst never allocates, and the
  pool size is your effect budget.
- **Text**: `Text` objects render through a canvas each time their text changes. For many small labels (counters on
  tiles), draw dots or icons from the atlas instead, or use `BitmapText`.

## HUD in the DOM, play in the canvas

Names, scores, buttons and timers are easier and cheaper as HTML over the canvas: text is sharp, layout is CSS,
and a button press does not need a frame. Give the HUD container `pointer-events: none` and the buttons
`pointer-events: auto`, so drags on the canvas still work underneath.

## Touch

- `touch-action: none` on the page, so the browser does not scroll or zoom during a drag.
- When dragging a piece with a finger, draw it above the finger (about one cell), or the finger hides where it
  lands.
- Test with `brawl-modes dev <mode> --bots 1 --host 0.0.0.0` and open the printed player link on a phone on the same
  network.

## Themes as data

Keep colors, tile styles and effect settings in one plain object (a theme) and build the atlas from it. Then a
seasonal look or a player's cosmetic is a different object, not a different build. The BlockBrawl modes'
`themes.js` shows the shape.

## Budgets review uses

| | Aim for |
|---|---|
| Idle (nothing moving) | no frames drawn |
| Busy (clears, explosions) | 60 fps on a mid-range phone, no frame over 33 ms on a low-end one |
| Live particles | a few hundred at most |
| Ambient effects | at most 30 fps, a few dozen sprites |
| Client size | under 5 MB (the hard limit); Pixi is about 1 MB of it |
