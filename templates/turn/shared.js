// Rules used by both the server and the client, so they can never disagree.

export const TARGET = 21;
export const MAX_ADD = 3;

/** Whether adding `n` is a legal move. */
export function isLegalAdd(n) {
  return Number.isInteger(n) && n >= 1 && n <= MAX_ADD;
}

/** The next player after `p` who is still in the match, or -1 if nobody is. */
export function nextPlayer(p, forfeited) {
  for (let step = 1; step <= forfeited.length; step++) {
    const q = (p + step) % forfeited.length;
    if (!forfeited[q]) return q;
  }
  return -1;
}
