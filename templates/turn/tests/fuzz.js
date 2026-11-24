// Used by `brawl-modes test` and `bench` to play random matches. Return a plausible action, or null to wait.
import { MAX_ADD } from '../shared.js';

export function nextAction(model, playerId, rng) {
  const { state } = model;
  if (state.winner !== -1 || state.order[state.turn] !== playerId) return null;
  return { t: 'add', n: 1 + rng.int(MAX_ADD) };
}
