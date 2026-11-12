// Deliberately broken: `total` lives outside `state`, so it is lost when the match moves to a
// fresh sandbox. `devkit test` must report this as a hydration failure.
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';

let total = 0;

export default defineMode({
  setup(ctx) {
    return { order: ctx.players.map((p) => p.id), a: 0, b: 0, over: false };
  },
  onAction(state, action, ctx) {
    if (state.over) throw reject('match_over');
    if (!action || (action.t !== 'a' && action.t !== 'b')) throw reject('unknown_action');
    state[action.t]++;
    total++;
    ctx.emit({ t: action.t, total });
    if (state.a + state.b >= 200) { state.over = true; ctx.emit({ t: 'over' }); }
  },
  sync(state) {
    return [{ t: 'state', a: state.a, b: state.b, over: state.over }];
  },
  result(state) {
    return state.over ? { ranking: [state.order] } : null;
  },
});
