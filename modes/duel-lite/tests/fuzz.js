// Action generator for `devkit test`. It sees only what a real client sees: the client model.
import { SIZE, canPlace } from '../shared.js';

export function nextAction(model, playerId, rng) {
  const s = model.state;
  if (s.over || s.order[s.turn] !== playerId) return null;

  const options = [];
  s.hand.forEach((pieceId, i) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (canPlace(s.board, pieceId, x, y)) options.push({ t: 'place', i, x, y });
      }
    }
  });
  return options.length > 0 ? rng.pick(options) : null;
}
