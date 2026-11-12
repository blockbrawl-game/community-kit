export function nextAction(model, playerId, rng) {
  return model.state.over ? null : { t: rng.next() < 0.5 ? 'a' : 'b' };
}
