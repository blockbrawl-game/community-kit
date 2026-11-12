// Stack Race client model with prediction.
//
// The model keeps two things apart:
//   - `auth`: what the server has confirmed, changed only by steps.
//   - `pending`: this player's actions that were sent but not yet acknowledged.
// What is drawn for the local piece is `auth` with `pending` replayed on top. When the server
// acknowledges or rejects an action it leaves `pending`, and the picture corrects itself.
import { canMove, dropY, lock } from '../shared.js';

export function createModel() {
  const auth = { me: -1, order: [], speed: 0, endsAt: 0, over: false, players: [] };
  let pending = [];
  let you = null;

  function apply(step) {
    const player = step.p === undefined ? null : auth.players[step.p];
    switch (step.t) {
      case 'state':
        auth.order = step.order;
        auth.me = auth.order.indexOf(you);
        auth.speed = step.speed;
        auth.endsAt = step.endsAt;
        auth.over = step.over;
        auth.players = step.players.map((p) => ({
          board: p.board.slice(),
          piece: p.piece ? { ...p.piece } : null,
          score: p.score,
          out: p.out,
        }));
        break;
      case 'spawn':
        player.piece = { x: step.x, y: 0, w: step.w };
        break;
      case 'pos':
        player.piece.x = step.x;
        break;
      case 'fall':
        player.piece.y++;
        break;
      case 'lock':
        lock(player.board, { x: step.x, y: step.y, w: step.w });
        player.score = step.score;
        player.piece = null;
        break;
      case 'out':
        player.out = true;
        player.piece = null;
        break;
      case 'speed':
        auth.speed = step.n;
        break;
      case 'over':
        auth.over = true;
        break;
    }
  }

  return {
    state: auth,

    applySync(steps, info) {
      you = info.you;
      pending = [];
      for (const step of steps) apply(step);
    },

    applySteps(batch) {
      for (const step of batch.steps) apply(step);
      if (batch.ackActionId !== undefined) {
        // Acks arrive in the order actions were sent, so everything up to this one is settled.
        const index = pending.findIndex((entry) => entry.actionId === batch.ackActionId);
        if (index >= 0) pending.splice(0, index + 1);
      }
    },

    onRejected(actionId) {
      pending = pending.filter((entry) => entry.actionId !== actionId);
    },

    /** Call right after game.send(action) so the action shows immediately. */
    predict(actionId, action) {
      pending.push({ actionId, action });
    },

    /** The local player's piece with unconfirmed actions applied, or null. */
    predictedPiece() {
      const mine = auth.players[auth.me];
      if (!mine || !mine.piece) return null;
      const piece = { ...mine.piece };
      for (const { action } of pending) {
        if (action.t === 'move' && canMove(mine.board, piece, action.dx)) piece.x += action.dx;
        else if (action.t === 'drop') { piece.y = dropY(mine.board, piece); break; }
      }
      return piece;
    },

    snapshot() {
      return JSON.parse(JSON.stringify(auth));
    },
  };
}
