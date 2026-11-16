// Rules shared by the server and the client model. Pure functions, no state of their own.

export const SIZE = 8;
export const HAND_SIZE = 3;
export const TURN_MS = 30000;
export const MAX_ROUNDS = 10;
export const LINE_SCORE = 10;

/** Piece shapes as [dx, dy] cell offsets from the top-left corner. */
export const PIECES = {
  dot: [[0, 0]],
  h2: [[0, 0], [1, 0]],
  v2: [[0, 0], [0, 1]],
  h3: [[0, 0], [1, 0], [2, 0]],
  v3: [[0, 0], [0, 1], [0, 2]],
  sq: [[0, 0], [1, 0], [0, 1], [1, 1]],
  l1: [[0, 0], [0, 1], [1, 1]],
  l2: [[0, 0], [1, 0], [0, 1]],
  t: [[0, 0], [1, 0], [2, 0], [1, 1]],
  z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};
export const PIECE_IDS = Object.keys(PIECES);

export function emptyBoard() {
  return new Array(SIZE * SIZE).fill(0);
}

export function canPlace(board, pieceId, x, y) {
  const cells = PIECES[pieceId];
  if (!cells || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  for (const [dx, dy] of cells) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) return false;
    if (board[cy * SIZE + cx] !== 0) return false;
  }
  return true;
}

/**
 * Places a piece and clears completed rows and columns. Mutates `board`.
 * @returns {{ rows: number[], cols: number[], gained: number }}
 */
export function place(board, pieceId, x, y, owner) {
  const cells = PIECES[pieceId];
  for (const [dx, dy] of cells) board[(y + dy) * SIZE + (x + dx)] = owner;

  const rows = [];
  const cols = [];
  for (let r = 0; r < SIZE; r++) {
    let full = true;
    for (let c = 0; c < SIZE; c++) if (board[r * SIZE + c] === 0) { full = false; break; }
    if (full) rows.push(r);
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE; r++) if (board[r * SIZE + c] === 0) { full = false; break; }
    if (full) cols.push(c);
  }
  for (const r of rows) for (let c = 0; c < SIZE; c++) board[r * SIZE + c] = 0;
  for (const c of cols) for (let r = 0; r < SIZE; r++) board[r * SIZE + c] = 0;

  return { rows, cols, gained: cells.length + LINE_SCORE * (rows.length + cols.length) };
}

export function hasAnyPlacement(board, hand) {
  for (const pieceId of hand) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (canPlace(board, pieceId, x, y)) return true;
      }
    }
  }
  return false;
}
