// Server logic: the only authority on the rules. Runs in the server's sandbox. While awake, onTick runs on every
// 50 ms slot with dtMs, the time since the previous onTick; ctx.sleepUntil(t) skips ticks until t, and any action
// wakes the mode again.
//
// state  plain JSON, the only place match data lives (the platform saves and restores it)
// steps  small facts sent to clients with ctx.emit; every change a client can see needs one
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';
import { DIRECTIONS, MATCH_MS, SIZE, STEP_MS, WIN_COINS, inside, startCell } from './shared.js';

/** A free cell for the coin, chosen with the seeded generator so replays match. */
function placeCoin(state, ctx) {
  const taken = new Set(state.players.map((pl) => pl.x + pl.y * SIZE));
  const free = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (!taken.has(i)) free.push(i);
  const i = ctx.rng.pick(free);
  state.coin = [i % SIZE, Math.floor(i / SIZE)];
  ctx.emit({ t: 'coin', x: state.coin[0], y: state.coin[1] });
}

function finish(state, ctx) {
  state.over = true;
  ctx.emit({ t: 'over' });
}

/** While nobody is moving there is nothing to tick until the match ends; an action wakes the mode. */
function rest(state, ctx) {
  if (state.over) ctx.sleep();
  else if (state.players.every((pl) => pl.out || pl.dir === null)) ctx.sleepUntil(MATCH_MS);
}

export default defineMode({
  setup(ctx) {
    const state = {
      order: ctx.players.map((p) => p.id),
      players: ctx.players.map((_, p) => {
        const [x, y] = startCell(p);
        return { x, y, dir: null, coins: 0, out: false };
      }),
      coin: [0, 0],
      stepIn: STEP_MS,
      over: false,
    };
    placeCoin(state, ctx);
    rest(state, ctx);
    return state;
  },

  // Actions only change direction; movement happens on the tick.
  onAction(state, action, ctx) {
    if (state.over) throw reject('match_over');
    const p = state.order.indexOf(ctx.playerId);
    if (state.players[p].out) throw reject('left_match');
    if (!action || action.t !== 'dir' || !Object.hasOwn(DIRECTIONS, action.d)) throw reject('bad_action');
    state.players[p].dir = action.d; // invisible to clients, so no step is needed
  },

  onTick(state, dtMs, ctx) {
    if (ctx.timeMs >= MATCH_MS) finish(state, ctx);
    if (state.over) return rest(state, ctx);

    // Movement in time, not ticks: one cell every STEP_MS, however the ticks fall.
    state.stepIn -= dtMs;
    if (state.stepIn > 0) return;
    state.stepIn = STEP_MS;

    state.players.forEach((pl, p) => {
      if (pl.out || pl.dir === null) return;
      const [dx, dy] = DIRECTIONS[pl.dir];
      if (!inside(pl.x + dx, pl.y + dy)) return;
      pl.x += dx;
      pl.y += dy;
      ctx.emit({ t: 'move', p, x: pl.x, y: pl.y });
    });

    for (const [p, pl] of state.players.entries()) {
      if (pl.out || pl.x !== state.coin[0] || pl.y !== state.coin[1]) continue;
      pl.coins++;
      ctx.emit({ t: 'score', p, coins: pl.coins });
      if (pl.coins >= WIN_COINS) {
        finish(state, ctx);
        break;
      }
      placeCoin(state, ctx);
      break;
    }
    rest(state, ctx);
  },

  onPlayerStatus(state, playerId, status, ctx) {
    if (status === 'forfeited' && !state.over) {
      const p = state.order.indexOf(playerId);
      state.players[p].out = true;
      ctx.emit({ t: 'left', p });
      if (state.players.length > 1 && state.players.filter((pl) => !pl.out).length <= 1) finish(state, ctx);
    }
    rest(state, ctx);
  },

  // Everything a joining or reconnecting player needs, from nothing. Read-only.
  sync(state) {
    return [{
      t: 'state',
      order: state.order,
      players: state.players.map((pl) => [pl.x, pl.y, pl.coins, pl.out ? 1 : 0]),
      coin: state.coin,
      over: state.over,
    }];
  },

  result(state) {
    if (!state.over) return null;
    // Most coins first; players who left rank last; equal scores share a place.
    const score = (p) => (state.players[p].out ? -1 : state.players[p].coins);
    const ranks = [...new Set(state.order.map((_, p) => score(p)))].sort((a, b) => b - a);
    return {
      ranking: ranks.map((s) => {
        const ids = state.order.filter((_, p) => score(p) === s);
        return ids.length === 1 ? ids[0] : ids;
      }),
      scores: Object.fromEntries(state.order.map((id, p) => [id, state.players[p].coins])),
    };
  },
});
