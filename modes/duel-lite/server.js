// Duel Lite: authoritative rules.
//
// Players are referred to by their index in `state.order` inside steps, which is shorter on the
// wire than a player id. Hands are private: the pieces go only to their owner, everyone else sees
// a count. `sync` rebuilds the same picture from nothing.
import { defineMode, reject } from '@blockbrawl/mode-sdk/server';
import { HAND_SIZE, MAX_ROUNDS, PIECE_IDS, TURN_MS, canPlace, emptyBoard, hasAnyPlacement, place } from './shared.js';

function dealHand(ctx) {
  return Array.from({ length: HAND_SIZE }, () => ctx.rng.pick(PIECE_IDS));
}

function activeCount(state) {
  return state.order.filter((id) => !state.forfeited[id]).length;
}

/** Moves the turn to the next player who can still act, or ends the match. */
function advanceTurn(state, ctx) {
  // Work on locals and commit only together with the 'turn' step, so that state never holds
  // something the clients were not told about.
  let turn = state.turn;
  let round = state.round;
  for (let tried = 0; tried < state.order.length; tried++) {
    turn = (turn + 1) % state.order.length;
    if (turn === 0) round++;
    if (round > MAX_ROUNDS) break;

    const playerId = state.order[turn];
    if (state.forfeited[playerId]) continue;
    if (!hasAnyPlacement(state.board, state.hands[playerId])) {
      ctx.emit({ t: 'skip', p: turn });
      continue;
    }

    state.turn = turn;
    state.round = round;
    state.deadline = ctx.timeMs + TURN_MS;
    ctx.emit({ t: 'turn', p: state.turn, round: state.round, deadline: state.deadline });
    return;
  }
  endMatch(state, ctx);
}

function endMatch(state, ctx) {
  state.over = true;
  ctx.emit({ t: 'over' });
}

export default defineMode({
  setup(ctx) {
    const order = ctx.players.map((p) => p.id);
    const state = {
      board: emptyBoard(),
      order,
      turn: 0,
      round: 1,
      deadline: TURN_MS,
      hands: {},
      scores: {},
      forfeited: {},
      over: false,
    };
    for (const id of order) {
      state.hands[id] = dealHand(ctx);
      state.scores[id] = 0;
    }
    return state;
  },

  onAction(state, action, ctx) {
    // Validate everything first. Nothing below the last `throw` may fail.
    if (state.over) throw reject('match_over');
    if (!action || action.t !== 'place') throw reject('unknown_action');
    if (state.order[state.turn] !== ctx.playerId) throw reject('not_your_turn');
    const hand = state.hands[ctx.playerId];
    if (!Number.isInteger(action.i) || action.i < 0 || action.i >= hand.length) throw reject('bad_piece');
    const pieceId = hand[action.i];
    if (!canPlace(state.board, pieceId, action.x, action.y)) throw reject('blocked');

    const p = state.turn;
    const { rows, cols, gained } = place(state.board, pieceId, action.x, action.y, p + 1);
    state.scores[ctx.playerId] += gained;
    hand.splice(action.i, 1);
    ctx.emit({ t: 'place', p, i: action.i, piece: pieceId, x: action.x, y: action.y, rows, cols, score: state.scores[ctx.playerId] });

    if (hand.length === 0) {
      state.hands[ctx.playerId] = dealHand(ctx);
      ctx.emit({ t: 'refill', p });
      ctx.emit({ t: 'hand', hand: state.hands[ctx.playerId] }, { to: ctx.playerId });
    }

    advanceTurn(state, ctx);
  },

  onTick(state, dtMs, ctx) {
    if (state.over || ctx.timeMs < state.deadline) return;
    ctx.emit({ t: 'timeout', p: state.turn });
    advanceTurn(state, ctx);
  },

  onPlayerStatus(state, playerId, status, ctx) {
    if (status !== 'forfeited' || state.over || state.forfeited[playerId]) return;
    state.forfeited[playerId] = true;
    ctx.emit({ t: 'forfeit', p: state.order.indexOf(playerId) });
    if (activeCount(state) <= 1) endMatch(state, ctx);
    else if (state.order[state.turn] === playerId) advanceTurn(state, ctx);
  },

  sync(state, playerId) {
    return [
      {
        t: 'state',
        board: state.board.join(''),
        order: state.order,
        turn: state.turn,
        round: state.round,
        deadline: state.deadline,
        scores: state.order.map((id) => state.scores[id]),
        handCounts: state.order.map((id) => state.hands[id].length),
        forfeited: state.order.map((id) => (state.forfeited[id] ? 1 : 0)),
        over: state.over,
      },
      { t: 'hand', hand: state.hands[playerId] ?? [] },
    ];
  },

  result(state) {
    if (!state.over) return null;
    const active = state.order.filter((id) => !state.forfeited[id]);
    const out = state.order.filter((id) => state.forfeited[id]);
    active.sort((a, b) => state.scores[b] - state.scores[a]);

    const ranking = [];
    for (const id of active) {
      const last = ranking[ranking.length - 1];
      const lastId = Array.isArray(last) ? last[0] : last;
      if (lastId !== undefined && state.scores[lastId] === state.scores[id]) {
        ranking[ranking.length - 1] = Array.isArray(last) ? [...last, id] : [last, id];
      } else {
        ranking.push(id);
      }
    }
    return { ranking: [...ranking, ...out], scores: state.scores };
  },
});
