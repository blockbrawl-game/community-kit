// The client's picture of the match, built only from steps. No DOM access, so `brawl-modes test` can run it.

export function createModel() {
  const state = { order: [], forfeited: [], total: 0, turn: 0, winner: -1 };
  let me = null;

  // One place that understands every step type, used for sync and live steps alike.
  function apply(step) {
    switch (step.t) {
      case 'state':
        state.order = [...step.order];
        state.forfeited = [...step.forfeited];
        state.total = step.total;
        state.turn = step.turn;
        state.winner = step.winner;
        break;
      case 'add': state.total = step.total; break;
      case 'turn': state.turn = step.p; break;
      case 'win': state.winner = step.p; break;
      case 'left': state.forfeited[step.p] = true; break;
    }
  }

  return {
    state,
    get me() { return me; },
    /** Index of this player in `state.order`, or -1 before the first sync. */
    get myIndex() { return state.order.indexOf(me); },
    applySync(steps, info) {
      me = info.you;
      for (const step of steps) apply(step);
    },
    applySteps(batch) {
      for (const step of batch.steps) apply(step);
    },
    // What the server has confirmed, as plain JSON. `test` compares it between a client that saw every step
    // and one that joined through sync.
    snapshot() {
      return { ...state, order: [...state.order], forfeited: [...state.forfeited] };
    },
  };
}
