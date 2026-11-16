// Duel Lite client model: rebuilt from steps, no DOM access, so the dev kit can run it headless.
import { HAND_SIZE, place } from '../shared.js';

export function createModel() {
  const m = {
    me: -1,
    board: [],
    order: [],
    turn: 0,
    round: 1,
    deadline: 0,
    scores: [],
    handCounts: [],
    forfeited: [],
    hand: [],
    over: false,
  };
  let you = null;

  function apply(step) {
    switch (step.t) {
      case 'state':
        m.board = Array.from(step.board, Number);
        m.order = step.order;
        m.me = m.order.indexOf(you);
        m.turn = step.turn;
        m.round = step.round;
        m.deadline = step.deadline;
        m.scores = step.scores.slice();
        m.handCounts = step.handCounts.slice();
        m.forfeited = step.forfeited.slice();
        m.over = step.over;
        break;
      case 'hand':
        m.hand = step.hand.slice();
        break;
      case 'place':
        // The server sends which lines cleared for animation; the board itself is recomputed
        // with the shared rules, so the step stays small.
        place(m.board, step.piece, step.x, step.y, step.p + 1);
        m.scores[step.p] = step.score;
        m.handCounts[step.p]--;
        if (step.p === m.me) m.hand.splice(step.i, 1);
        break;
      case 'refill':
        m.handCounts[step.p] = HAND_SIZE;
        break;
      case 'turn':
        m.turn = step.p;
        m.round = step.round;
        m.deadline = step.deadline;
        break;
      case 'forfeit':
        m.forfeited[step.p] = 1;
        break;
      case 'over':
        m.over = true;
        break;
      // 'skip' and 'timeout' carry no model change; the view shows them as notices.
    }
  }

  return {
    state: m,
    applySync(steps, info) {
      you = info.you;
      for (const step of steps) apply(step);
    },
    applySteps(batch) {
      for (const step of batch.steps) apply(step);
    },
    snapshot() {
      return JSON.parse(JSON.stringify(m));
    },
  };
}
