export function nextAction(model, playerId, rng) {
  return model.state.over ? null : { t: 'mark', i: rng.int(150 * 150) };
}
