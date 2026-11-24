// Used by `brawl-modes test` and `bench` to play random matches. Return a plausible action, or null to wait.
import { DIRECTIONS } from '../shared.js';

const NAMES = Object.keys(DIRECTIONS);

export function nextAction(model, playerId, rng) {
  if (model.state.over) return null;
  // Head roughly toward the coin, like a real player would, with some wandering.
  const p = model.state.order.indexOf(playerId);
  const me = model.state.players[p];
  if (!me || rng.next() < 0.3) return { t: 'dir', d: rng.pick(NAMES) };
  const [cx, cy] = model.state.coin;
  if (cx !== me.x) return { t: 'dir', d: cx > me.x ? 'right' : 'left' };
  return { t: 'dir', d: cy > me.y ? 'down' : 'up' };
}
