// Rules used by both the server and the client, so they can never disagree.

export const SIZE = 9;
export const WIN_COINS = 5;
export const MATCH_MS = 60_000;
export const DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Where each player starts: the corners, then the middle of the edges. */
export function startCell(p) {
  const last = SIZE - 1;
  const mid = (SIZE - 1) / 2;
  return [[0, 0], [last, last], [last, 0], [0, last], [mid, 0], [mid, last], [0, mid], [last, mid]][p % 8];
}

export function inside(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}
