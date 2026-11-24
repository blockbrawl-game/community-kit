// MatchHost: runs one match of a mode. This is the dev kit twin of CommunityMatchGrain and defines
// the wire protocol between server and shell:
//
//   server -> client   { kind: 'sync',  seq, timeMs, steps, info }
//                      { kind: 'steps', seq, timeMs, steps, ackActionId? }
//                      { kind: 'rejected', actionId, reason }
//                      { kind: 'result', result }
//                      { kind: 'aborted', reason }
//   client -> server   { kind: 'action', actionId, action }
//                      { kind: 'sync' }
import { createHash } from 'node:crypto';
import { Sandbox, ModeError } from './sandbox.js';
import { limits as defaultLimits } from './build.js';
import { due, nextTickMs } from './clock.js';
import { ENVELOPE_ALLOWANCE, Outbox, shouldWait } from './outbox.js';

export class MatchHost {
  /**
   * @param {object} options
   * @param {object} options.manifest parsed mode.json
   * @param {string} options.bundle bundled server script
   * @param {{id: string, name: string, isBot: boolean}[]} options.players
   * @param {number} options.seed
   * @param {(playerId: string, message: object) => void} [options.onSend]
   * @param {object} [options.limits]
   * @param {boolean} [options.countWork] count work units per call (devkit/work.js), for `bench`
   */
  constructor({ manifest, bundle, players, seed, onSend, limits, countWork }) {
    this.manifest = manifest;
    this.bundle = bundle;
    this.players = players;
    this.seed = seed;
    this.onSend = onSend ?? (() => {});
    this.limits = { ...defaultLimits, ...limits };

    this.countWork = countWork === true;
    this.sandbox = this.#newSandbox();
    this.timeMs = 0;
    // When the mode wants its next tick (devkit/clock.js): 0 for the next slot, a match time, or -1 (ASLEEP).
    this.wake = 0;
    this.seq = new Map(players.map((p) => [p.id, 0]));
    this.result = null;
    this.aborted = null;

    // Everything needed to replay this match, a running hash of everything the mode produced, and one of what each
    // player was sent (the wire hash: it covers the outbox's merging and numbering too).
    this.inputs = [];
    this.outputHash = createHash('sha256').update('blockbrawl-mode-v1').digest('hex');
    this.wire = players.map(() => createHash('sha256').update('blockbrawl-wire-v1').digest('hex'));
    this.stats = { maxStateBytes: 0, maxBatchBytes: 0, bytesSent: 0, batches: 0 };
    this.outbox = new Outbox(players.length, this.limits.maxBatchBytes, (p) => this.#nextSeq(p), (p, message) => this.#send(this.players[p].id, message));
  }

  /** The hash of what every player was sent, in order (syncs left out: they depend on when someone asks). */
  get wireHash() {
    return createHash('sha256').update(this.wire.join(',')).digest('hex');
  }

  #nextSeq(p) {
    const id = this.players[p].id;
    const seq = this.seq.get(id) + 1;
    this.seq.set(id, seq);
    return seq;
  }

  /** Sends everything pending in the outbox now (the server does at the end of a tick, or when it goes away). */
  flush() {
    this.outbox.flush();
  }

  /**
   * The end of a call's turn, as in the server's grain: a tick sends everything; any other call sends what is
   * pending unless a tick is due within the next slot (devkit/outbox.js).
   */
  #endTurn(isTick) {
    const next = this.ended ? null : nextTickMs(this.timeMs, this.wake);
    if (isTick || !shouldWait(this.timeMs, next)) this.outbox.flush();
  }

  get ended() {
    return this.result !== null || this.aborted !== null;
  }

  start() {
    const input = JSON.stringify({ players: this.players, seed: this.seed, limits: { maxStepsPerCall: this.limits.maxStepsPerCall } });
    this.#run('setup', [input], {});
    // Players start from a sync, which already has setup's opening steps, as on the server.
    this.outbox.discard();
  }

  #newSandbox() {
    const sandbox = new Sandbox(this.bundle, { maxCallMs: this.limits.maxCallMs, countWork: this.countWork });
    sandbox.playerIds = this.players.map((p) => p.id);
    return sandbox;
  }

  #indexOf(playerId) {
    return this.players.findIndex((p) => p.id === playerId);
  }

  /** @param {number} [atTimeMs] host match time of the action; ignored if earlier than the current clock */
  action(playerId, actionId, action, atTimeMs) {
    if (this.ended) return;
    if (!this.seq.has(playerId)) return;
    if (typeof atTimeMs === 'number' && atTimeMs > this.timeMs) this.timeMs = atTimeMs;

    if (JSON.stringify(action ?? null).length > this.limits.maxActionBytes) {
      this.outbox.message(this.#indexOf(playerId), { kind: 'rejected', actionId, reason: 'action_too_large' });
      this.#endTurn(false);
      return;
    }
    this.inputs.push({ op: 'action', playerId, actionId, action, timeMs: this.timeMs });
    const actionText = action === undefined ? undefined : JSON.stringify(action);
    this.#run('action', [this.#indexOf(playerId), actionText, this.timeMs], { actorId: playerId, actionId });
    this.#endTurn(false);
  }

  /** Ticks the mode at grid slot atTimeMs. The prelude computes dtMs: the time since the previous onTick. */
  tick(atTimeMs) {
    if (this.ended) return;
    this.timeMs = Math.max(this.timeMs, atTimeMs);
    this.inputs.push({ op: 'tick', timeMs: this.timeMs });
    this.#run('tick', [this.timeMs], {});
    this.#endTurn(true);
  }

  /**
   * Runs the tick that is due at host match time hostMs (devkit/clock.js), as the server's timer does: once, on
   * the latest slot. Call it before an action at hostMs, so the action never comes before a tick that was due.
   * Returns the milliseconds of lag beyond the cap that were dropped: the caller's clock should fall behind by
   * that much, as the server's does.
   */
  advanceTo(hostMs) {
    if (this.ended) return 0;
    const tick = due(this.timeMs, hostMs, this.wake);
    if (!tick) return 0;
    this.tick(tick.atMs);
    return tick.droppedMs;
  }

  /** Milliseconds from host match time hostMs until the next tick is due; Infinity while the mode sleeps. */
  msToNextTick(hostMs) {
    const next = this.ended ? null : nextTickMs(this.timeMs, this.wake);
    return next === null ? Infinity : Math.max(0, next - hostMs);
  }

  /** @param {'disconnected' | 'reconnected' | 'forfeited'} status */
  setStatus(playerId, status) {
    if (this.ended) return;
    this.inputs.push({ op: 'status', playerId, status, timeMs: this.timeMs });
    this.#run('status', [this.#indexOf(playerId), status, this.timeMs], {});
    this.#endTurn(false);
  }

  /** Builds the full catch-up message for one player without sending it. */
  buildSync(playerId) {
    let steps;
    try {
      steps = this.sandbox.sync(this.#indexOf(playerId));
    } catch (error) {
      if (error instanceof ModeError) this.#abort(error.message);
      throw error;
    }
    return {
      kind: 'sync',
      seq: this.seq.get(playerId),
      timeMs: this.timeMs,
      steps,
      info: { modeId: this.manifest.id, version: this.manifest.version, you: playerId, players: this.players },
    };
  }

  /** Sends the catch-up message to one player; it replaces whatever was pending for them. */
  sync(playerId) {
    const message = this.buildSync(playerId);
    const p = this.#indexOf(playerId);
    this.outbox.sync(p, message);
    if (this.result) this.outbox.message(p, { kind: 'result', result: this.result });
    if (this.aborted) this.outbox.message(p, { kind: 'aborted', reason: this.aborted });
    return message;
  }

  exportState() {
    return this.sandbox.exportState();
  }

  /** Throws the sandbox away and continues in a fresh one, exactly like a grain reactivation. */
  hydrate() {
    const snapshot = this.sandbox.exportState();
    const previous = this.sandbox;
    this.sandbox = this.#newSandbox();
    this.sandbox.callTimes = previous.callTimes;
    this.sandbox.work = previous.work;
    this.sandbox.logs = previous.logs;
    this.wake = this.sandbox.importState(snapshot);
  }

  stateHash() {
    return createHash('sha256').update(this.exportState()).digest('hex');
  }

  #call(fn, args) {
    try {
      return this.sandbox.call(fn, args);
    } catch (error) {
      if (error instanceof ModeError) this.#abort(error.message);
      throw error;
    }
  }

  #run(fn, args, { actorId, actionId }) {
    const { out, raw } = this.#call(fn, args);
    // An empty output (nothing happened) leaves the hash as it is, on the server as here.
    if (raw !== '') this.outputHash = createHash('sha256').update(this.outputHash).update(raw).digest('hex');
    if (out.wake !== null) this.wake = out.wake;

    if (out.rejected !== null) {
      if (actorId) this.outbox.message(this.#indexOf(actorId), { kind: 'rejected', actionId, reason: out.rejected });
      return;
    }

    // Each player's steps from this call go to the outbox, which merges and numbers them (devkit/outbox.js).
    const perPlayer = this.players.map((player, index) => out.steps.filter((e) => e.to === -1 || e.to === index).map((e) => e.json));
    for (let index = 0; index < this.players.length; index++) {
      const jsons = perPlayer[index];
      // The envelope is the platform's: the limit is on the steps, with room left for it (as on the server).
      const chars = jsons.length === 0 ? 2 : jsons.reduce((sum, json) => sum + json.length, 0) + jsons.length + 1;
      if (chars + ENVELOPE_ALLOWANCE > this.limits.maxBatchBytes) {
        this.#abort(`A step batch of ${chars} bytes exceeds the ${this.limits.maxBatchBytes - ENVELOPE_ALLOWANCE} byte limit for steps.`);
        throw new ModeError(this.aborted, { limit: 'maxBatchBytes' });
      }
    }
    for (let index = 0; index < this.players.length; index++) {
      const isActor = this.players[index].id === actorId;
      this.outbox.steps(index, perPlayer[index], this.timeMs, isActor && actionId !== undefined ? actionId : undefined);
    }

    if (out.resultJson !== null) {
      this.result = JSON.parse(out.resultJson);
      this.outbox.message(-1, { kind: 'result', result: this.result });
    }
  }

  /** Checks the state size limit. Not done on every call because serializing the state is not free. */
  checkStateSize() {
    const bytes = this.exportState().length;
    this.stats.maxStateBytes = Math.max(this.stats.maxStateBytes, bytes);
    if (bytes > this.limits.maxStateBytes) {
      this.#abort(`State of ${bytes} bytes exceeds the ${this.limits.maxStateBytes} byte limit.`);
      throw new ModeError(this.aborted, { limit: 'maxStateBytes' });
    }
    return bytes;
  }

  #abort(reason) {
    if (this.aborted) return;
    this.aborted = reason;
    this.outbox.message(-1, { kind: 'aborted', reason });
  }

  #send(playerId, message) {
    const text = JSON.stringify(message);
    if (message.kind === 'steps') {
      this.stats.batches++;
      this.stats.bytesSent += text.length;
      this.stats.maxBatchBytes = Math.max(this.stats.maxBatchBytes, text.length);
    }
    if (message.kind !== 'sync') {
      const p = this.#indexOf(playerId);
      this.wire[p] = createHash('sha256').update(this.wire[p]).update(text).digest('hex');
    }
    this.onSend(playerId, message);
  }
}

export function devPlayers(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    name: `Player ${i + 1}`,
    isBot: false,
  }));
}
