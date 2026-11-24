// The match's outbox: what a match sends, merged into as few messages as it can without making anyone wait for
// what concerns them. The server's MatchOutbox (Logic/MatchOutbox.cs in the game) is the same algorithm, so a
// recording's wire hash agrees on both hosts.
//
//   - The acting player's acknowledgement goes out at once, after that player's pending steps and the action's own.
//   - A rejection goes out at once, after that player's pending steps.
//   - A sync replaces that player's pending steps (it already contains them) and goes out at once.
//   - A result or an abort goes out at once, after every pending step it concerns.
//   - A merged batch stays within the batch limit: when the next call's steps would not fit, what is pending goes first.
//   - Everything else waits for the next flush: the end of a tick, or the end of any call when no tick is due within
//     the next slot (shouldWait). An awake mode sends each player at most one batch a slot, plus acknowledgements.
import { SLOT_MS } from './clock.js';

/** Room left in a step batch for its envelope: a call's steps, and merged steps, must fit in maxBatchBytes minus this. */
export const ENVELOPE_ALLOWANCE = 128;

/** Whether what a call left pending may wait for the next tick: one is due within the next slot after the call. */
export function shouldWait(timeMs, nextTickMs) {
  return nextTickMs !== null && nextTickMs - timeMs <= SLOT_MS;
}

export class Outbox {
  /**
   * @param {number} playerCount
   * @param {number} maxBatchBytes
   * @param {(playerIndex: number) => number} nextSeq numbers the next batch for a player
   * @param {(playerIndex: number, message: object) => void} deliver
   */
  constructor(playerCount, maxBatchBytes, nextSeq, deliver) {
    this.maxStepsChars = maxBatchBytes - ENVELOPE_ALLOWANCE;
    this.nextSeq = nextSeq;
    this.deliver = deliver;
    // Per player: the JSON text of each pending step, the length of their comma-joined text, and the latest call's time.
    this.pending = Array.from({ length: playerCount }, () => ({ steps: [], chars: 0, timeMs: 0 }));
  }

  get hasPending() {
    return this.pending.some((p) => p.steps.length > 0);
  }

  /** One call's steps for one player (JSON texts), with the action id when the player is the actor. */
  steps(p, stepJsons, timeMs, ackActionId) {
    if (stepJsons.length > 0) {
      const inner = stepJsons.reduce((sum, json) => sum + json.length, 0) + stepJsons.length - 1;
      const before = this.pending[p];
      if (before.steps.length > 0 && before.chars + 1 + inner + 2 > this.maxStepsChars) this.#send(p, undefined, before.timeMs);
      const pending = this.pending[p]; // #send starts a fresh list
      pending.chars += (pending.steps.length > 0 ? 1 : 0) + inner;
      pending.steps.push(...stepJsons);
      pending.timeMs = timeMs;
    }
    if (ackActionId !== undefined) this.#send(p, ackActionId, timeMs);
  }

  /** A sync for one player: their pending steps are in it. */
  sync(p, message) {
    this.pending[p] = { steps: [], chars: 0, timeMs: 0 };
    this.deliver(p, message);
  }

  /** A rejection, result or abort for one player (p >= 0) or everyone (p = -1). */
  message(p, message) {
    if (p >= 0) {
      this.#send(p, undefined, this.pending[p].timeMs);
      this.deliver(p, message);
    } else {
      this.flush();
      for (let i = 0; i < this.pending.length; i++) this.deliver(i, message);
    }
  }

  /** Forgets every pending step without sending it (setup's opening steps: every player's first sync has them). */
  discard() {
    for (let p = 0; p < this.pending.length; p++) this.pending[p] = { steps: [], chars: 0, timeMs: 0 };
  }

  /** Sends every player's pending steps. */
  flush() {
    for (let p = 0; p < this.pending.length; p++) this.#send(p, undefined, this.pending[p].timeMs);
  }

  #send(p, ackActionId, timeMs) {
    const pending = this.pending[p];
    if (pending.steps.length === 0 && ackActionId === undefined) return;
    const message = { kind: 'steps', seq: this.nextSeq(p), timeMs, steps: pending.steps.map((json) => JSON.parse(json)) };
    if (ackActionId !== undefined) message.ackActionId = ackActionId;
    this.pending[p] = { steps: [], chars: 0, timeMs: 0 };
    this.deliver(p, message);
  }
}
