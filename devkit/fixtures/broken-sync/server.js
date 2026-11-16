// Deliberately broken: sync() forgets `b`, so a player who reconnects sees a different match from
// one who never left. `devkit test` must report this as a sync failure.
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';

export default defineMode({
  setup(ctx) {
    return { order: ctx.players.map((p) => p.id), a: 0, b: 0, over: false };
  },
  onAction(state, action, ctx) {
    if (state.over) throw reject('match_over');
    if (!action || (action.t !== 'a' && action.t !== 'b')) throw reject('unknown_action');
    state[action.t]++;
    ctx.emit({ t: action.t });
    if (state.a + state.b >= 200) { state.over = true; ctx.emit({ t: 'over' }); }
  },
  sync(state) {
    return [{ t: 'state', a: state.a, over: state.over }];
  },
  result(state) {
    return state.over ? { ranking: [state.order] } : null;
  },
});
