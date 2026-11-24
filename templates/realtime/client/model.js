// The client's picture of the match, built only from steps. No DOM access, so `brawl-modes test` can run it.

export function createModel() {
  const state = { order: [], players: [], coin: [0, 0], over: false };
  let me = null;

  // One place that understands every step type, used for sync and live steps alike.
  function apply(step) {
    switch (step.t) {
      case 'state':
        state.order = [...step.order];
        state.players = step.players.map(([x, y, coins, out]) => ({ x, y, coins, out: out === 1 }));
        state.coin = [...step.coin];
        state.over = step.over;
        break;
      case 'move': state.players[step.p].x = step.x; state.players[step.p].y = step.y; break;
      case 'score': state.players[step.p].coins = step.coins; break;
      case 'coin': state.coin = [step.x, step.y]; break;
      case 'left': state.players[step.p].out = true; break;
      case 'over': state.over = true; break;
    }
  }

  return {
    state,
    get me() { return me; },
    get myIndex() { return state.order.indexOf(me); },
    applySync(steps, info) {
      me = info.you;
      for (const step of steps) apply(step);
    },
    applySteps(batch) {
      for (const step of batch.steps) apply(step);
    },
    // What the server has confirmed, as plain JSON (no local predictions).
    snapshot() {
      return {
        order: [...state.order],
        players: state.players.map((pl) => ({ ...pl })),
        coin: [...state.coin],
        over: state.over,
      };
    },
  };
}
