// Stack Race: authoritative rules for a real-time mode.
//
// Bandwidth notes: gravity is a tiny { t: 'fall', p } step and clients move the piece themselves;
// a lock sends only the piece position and the new score, and clients recompute cleared rows with
// the shared rules.
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';
import { MATCH_MS, ROW_SCORE, W, canFall, canMove, collides, dropY, emptyBoard, fallTicksAt, lock } from './shared.js';

function spawn(state, p, ctx) {
  const player = state.players[p];
  const w = 1 + ctx.rng.int(3);
  const piece = { x: Math.floor((W - w) / 2), y: 0, w };
  if (collides(player.board, piece)) {
    player.piece = null;
    player.out = true;
    ctx.emit({ t: 'out', p });
    return;
  }
  player.piece = piece;
  player.fallIn = state.fallTicks;
  ctx.emit({ t: 'spawn', p, x: piece.x, w: piece.w });
}

function lockPiece(state, p, ctx) {
  const player = state.players[p];
  const piece = player.piece;
  const cleared = lock(player.board, piece);
  player.score += piece.w + cleared * ROW_SCORE;
  ctx.emit({ t: 'lock', p, x: piece.x, y: piece.y, w: piece.w, score: player.score });
  spawn(state, p, ctx);
}

function checkOver(state, ctx) {
  if (state.over) return;
  if (ctx.timeMs >= MATCH_MS || state.players.every((player) => player.out)) {
    state.over = true;
    ctx.emit({ t: 'over' });
  }
}

export default defineMode({
  setup(ctx) {
    const state = {
      order: ctx.players.map((p) => p.id),
      fallTicks: fallTicksAt(0),
      players: ctx.players.map(() => ({ board: emptyBoard(), piece: null, fallIn: 0, score: 0, out: false })),
      over: false,
    };
    for (let p = 0; p < state.players.length; p++) spawn(state, p, ctx);
    return state;
  },

  onAction(state, action, ctx) {
    if (state.over) throw reject('match_over');
    const p = state.order.indexOf(ctx.playerId);
    const player = state.players[p];
    if (!player || player.out || !player.piece) throw reject('out');

    if (action && action.t === 'move' && (action.dx === -1 || action.dx === 1)) {
      if (!canMove(player.board, player.piece, action.dx)) throw reject('blocked');
      player.piece.x += action.dx;
      ctx.emit({ t: 'pos', p, x: player.piece.x });
    } else if (action && action.t === 'drop') {
      player.piece.y = dropY(player.board, player.piece);
      lockPiece(state, p, ctx);
      checkOver(state, ctx);
    } else {
      throw reject('unknown_action');
    }
  },

  onTick(state, dtMs, ctx) {
    if (state.over) return;

    const fallTicks = fallTicksAt(ctx.timeMs);
    if (fallTicks !== state.fallTicks) {
      state.fallTicks = fallTicks;
      ctx.emit({ t: 'speed', n: fallTicks });
    }

    for (let p = 0; p < state.players.length; p++) {
      const player = state.players[p];
      if (player.out || !player.piece) continue;
      if (--player.fallIn > 0) continue;
      player.fallIn = state.fallTicks;
      if (canFall(player.board, player.piece)) {
        player.piece.y++;
        ctx.emit({ t: 'fall', p });
      } else {
        lockPiece(state, p, ctx);
      }
    }
    checkOver(state, ctx);
  },

  onPlayerStatus(state, playerId, status, ctx) {
    if (status !== 'forfeited' || state.over) return;
    const p = state.order.indexOf(playerId);
    const player = state.players[p];
    if (!player || player.out) return;
    player.out = true;
    player.piece = null;
    ctx.emit({ t: 'out', p });
    checkOver(state, ctx);
  },

  sync(state) {
    return [
      {
        t: 'state',
        order: state.order,
        speed: state.fallTicks,
        endsAt: MATCH_MS,
        over: state.over,
        players: state.players.map((player) => ({
          board: player.board,
          piece: player.piece,
          score: player.score,
          out: player.out,
        })),
      },
    ];
  },

  result(state) {
    if (!state.over) return null;
    const scores = {};
    state.order.forEach((id, p) => { scores[id] = state.players[p].score; });
    const sorted = [...state.order].sort((a, b) => scores[b] - scores[a]);
    const ranking = [];
    for (const id of sorted) {
      const last = ranking[ranking.length - 1];
      const lastId = Array.isArray(last) ? last[0] : last;
      if (lastId !== undefined && scores[lastId] === scores[id]) {
        ranking[ranking.length - 1] = Array.isArray(last) ? [...last, id] : [last, id];
      } else {
        ranking.push(id);
      }
    }
    return { ranking, scores };
  },
});
