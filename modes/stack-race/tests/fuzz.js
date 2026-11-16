// Action generator for `devkit test`. It sees only what a real client sees: the client model.
import { canMove } from '../shared.js';

export function nextAction(model, playerId, rng) {
  const s = model.state;
  const mine = s.players[s.order.indexOf(playerId)];
  if (s.over || !mine || mine.out || !mine.piece) return null;

  const roll = rng.next();
  if (roll < 0.25) return { t: 'drop' };
  if (roll < 0.6) {
    const dx = rng.next() < 0.5 ? -1 : 1;
    return canMove(mine.board, mine.piece, dx) ? { t: 'move', dx } : null;
  }
  return null;
}
