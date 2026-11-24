// Server logic: the only authority on the rules. Runs in the server's sandbox.
//
// state  plain JSON, the only place match data lives (the platform saves and restores it)
// steps  small facts sent to clients with ctx.emit; every change a client can see needs one
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';
import { TARGET, isLegalAdd, nextPlayer } from './shared.js';

export default defineMode({
  setup(ctx) {
    return {
      order: ctx.players.map((p) => p.id),
      forfeited: ctx.players.map(() => false),
      total: 0,
      turn: 0,
      winner: -1,
    };
  },

  onAction(state, action, ctx) {
    // Validate everything first. A rejected action must leave state exactly as it was.
    if (state.winner !== -1) throw reject('match_over');
    const p = state.order.indexOf(ctx.playerId);
    if (p !== state.turn) throw reject('not_your_turn');
    if (!action || action.t !== 'add' || !isLegalAdd(action.n)) throw reject('bad_action');

    state.total += action.n;
    ctx.emit({ t: 'add', p, n: action.n, total: state.total });

    if (state.total >= TARGET) {
      state.winner = p;
      ctx.emit({ t: 'win', p });
    } else {
      state.turn = nextPlayer(p, state.forfeited);
      ctx.emit({ t: 'turn', p: state.turn });
    }
  },

  onPlayerStatus(state, playerId, status, ctx) {
    if (status !== 'forfeited' || state.winner !== -1) return;
    const p = state.order.indexOf(playerId);
    state.forfeited[p] = true;
    ctx.emit({ t: 'left', p });

    const remaining = state.forfeited.filter((f) => !f).length;
    if (remaining === 1) {
      state.winner = state.forfeited.indexOf(false);
      ctx.emit({ t: 'win', p: state.winner });
    } else if (state.turn === p) {
      state.turn = nextPlayer(p, state.forfeited);
      ctx.emit({ t: 'turn', p: state.turn });
    }
  },

  // Everything a joining or reconnecting player needs, from nothing. Read-only.
  sync(state) {
    return [{ t: 'state', order: state.order, forfeited: state.forfeited, total: state.total, turn: state.turn, winner: state.winner }];
  },

  result(state) {
    if (state.winner === -1) return null;
    const others = state.order.filter((_, p) => p !== state.winner);
    return { ranking: others.length > 0 ? [state.order[state.winner], others] : [state.order[state.winner]] };
  },
});
