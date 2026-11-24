// Rules shared by the server and the client. The client uses the same functions to predict its own
// moves before the server confirms them, which is what makes prediction cheap and correct.

export const W = 6;
export const H = 12;
export const FULL_ROW = (1 << W) - 1;
export const MATCH_MS = 90000;
export const START_FALL_MS = 500; // time between gravity steps at the start
export const MIN_FALL_MS = 200;
export const FALL_STEP_MS = 100; // gravity gets this much faster every SPEED_UP_EVERY_MS
export const SPEED_UP_EVERY_MS = 15000;
export const ROW_SCORE = 10;

/** A board is H rows from top to bottom, each row a bitmask of W cells. */
export function emptyBoard() {
  return new Array(H).fill(0);
}

function mask(piece) {
  return ((1 << piece.w) - 1) << piece.x;
}

/** A piece is a horizontal bar: { x, y, w }. */
export function collides(board, piece) {
  if (piece.x < 0 || piece.x + piece.w > W || piece.y < 0 || piece.y >= H) return true;
  return (board[piece.y] & mask(piece)) !== 0;
}

export function canMove(board, piece, dx) {
  return !collides(board, { x: piece.x + dx, y: piece.y, w: piece.w });
}

export function canFall(board, piece) {
  return !collides(board, { x: piece.x, y: piece.y + 1, w: piece.w });
}

export function dropY(board, piece) {
  let y = piece.y;
  while (!collides(board, { x: piece.x, y: y + 1, w: piece.w })) y++;
  return y;
}

/** Fixes the piece into the board and removes full rows. Mutates `board`. Returns rows cleared. */
export function lock(board, piece) {
  board[piece.y] |= mask(piece);
  let cleared = 0;
  for (let r = H - 1; r >= 0; r--) {
    if (board[r] === FULL_ROW) {
      board.splice(r, 1);
      board.unshift(0);
      cleared++;
      r++;
    }
  }
  return cleared;
}

export function fallMsAt(timeMs) {
  return Math.max(MIN_FALL_MS, START_FALL_MS - FALL_STEP_MS * Math.floor(timeMs / SPEED_UP_EVERY_MS));
}
