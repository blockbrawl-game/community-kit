// Deliberately too expensive: every action rescans a 150 x 150 grid to recount the score instead of
// keeping a running total. The rules are right and `brawl-modes test` passes, but two players acting at
// the server's rate limit would cost over a million work units a second, so `brawl-modes bench` must
// report it as over budget.
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';

const SIZE = 150;

export default defineMode({
  setup(ctx) {
    return { order: ctx.players.map((p) => p.id), marks: {}, score: 0, moves: 0, over: false };
  },
  onAction(state, action, ctx) {
    if (state.over) throw reject('match_over');
    if (!action || action.t !== 'mark' || !Number.isInteger(action.i) || action.i < 0 || action.i >= SIZE * SIZE) {
      throw reject('unknown_action');
    }
    state.marks[action.i] = true;
    state.moves++;
    let score = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (state.marks[y * SIZE + x]) score++;
      }
    }
    state.score = score;
    ctx.emit({ t: 'score', score });
    if (state.moves >= 60) { state.over = true; ctx.emit({ t: 'over' }); }
  },
  sync(state) {
    return [{ t: 'state', score: state.score, over: state.over }];
  },
  result(state) {
    return state.over ? { ranking: [state.order] } : null;
  },
});
