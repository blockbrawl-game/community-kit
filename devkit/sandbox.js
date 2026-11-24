// Node `vm` host for a mode: the dev kit twin of the ClearScript sandbox used in the silo.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { communityRoot, limits as defaultLimits } from './build.js';
import { counterName, instrument } from './work.js';
import { decodeFrames, legacyStepsJsonLength } from './wire.js';

const preludeSource = readFileSync(path.join(communityRoot, 'runtime', 'prelude.js'), 'utf8');
const preludeScript = new vm.Script(preludeSource, { filename: 'prelude.js' });
const callScript = new vm.Script('__bb[__bbFn](__bbA, __bbB, __bbC)', { filename: 'host-call.js' });

/** The mode threw something other than a rejection, or broke a limit. The match cannot continue. */
export class ModeError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ModeError';
    this.details = details;
  }
}

export class Sandbox {
  /**
   * @param {string} bundle bundled mode script
   * @param {{ maxCallMs?: number, countWork?: boolean }} [options] countWork: run an instrumented copy of the
   *   bundle that counts work units (devkit/work.js); each call's count is in `work`.
   */
  constructor(bundle, options = {}) {
    this.maxCallMs = options.maxCallMs ?? defaultLimits.maxCallMs;
    this.callTimes = [];
    this.logs = [];
    /** With countWork: one { fn, units, bytes } per call, in order. */
    this.work = [];
    /** The players' ids in setup order (MatchHost sets it): private steps name a player by index. */
    this.playerIds = [];
    this.workUnits = 0;
    // An empty context: JavaScript built-ins only. No require, process, timers or network.
    this.context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    let source = bundle;
    if (options.countWork) {
      // The counter lives here, outside the mode's reach: the mode can only call it (which only adds),
      // never read or reset it, and its name is random so the mode cannot shadow it.
      const name = counterName();
      const self = this;
      Object.defineProperty(this.context, name, {
        value: function count() { self.workUnits++; },
        writable: false, configurable: false, enumerable: false,
      });
      source = instrument(bundle, name);
    }
    preludeScript.runInContext(this.context);
    try {
      vm.runInContext(source, this.context, { filename: 'mode-server.js', timeout: 1000 });
    } catch (error) {
      throw new ModeError(`Mode failed to load: ${error.message}`, { stack: error.stack });
    }
  }

  /**
   * Calls one prelude entry point with up to three plain arguments. Returns the decoded output (devkit/wire.js,
   * steps carrying their JSON text and a player index) and the raw string (used for hashing).
   */
  call(fn, args = []) {
    this.context.__bbFn = fn;
    this.context.__bbA = args[0];
    this.context.__bbB = args[1];
    this.context.__bbC = args[2];
    const started = performance.now();
    const unitsBefore = this.workUnits;
    let raw;
    try {
      raw = callScript.runInContext(this.context, { timeout: this.maxCallMs });
    } catch (error) {
      if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new ModeError(`${fn}() exceeded the ${this.maxCallMs} ms time limit.`, { limit: 'maxCallMs' });
      }
      throw new ModeError(`${fn}() crashed the sandbox: ${error.message}`, { stack: error.stack });
    }
    this.callTimes.push(performance.now() - started);
    if (typeof raw !== 'string') throw new ModeError(`${fn}() returned no result.`);
    let out;
    try {
      out = decodeFrames(raw);
    } catch (error) {
      throw new ModeError(`${fn}() returned malformed output: ${error.message}`);
    }
    // The data a mode is answerable for: the steps it emits and the actions its clients send. The fixed
    // wrapping around them (player ids, clock, envelope) is the platform's and the same for every mode. Measured
    // as it always was (devkit/wire.js), so the wire format does not change a mode's bench numbers.
    const actionText = fn === 'action' ? args[1] : undefined;
    // (A rejection used to carry an empty step list, "[]": 2 bytes.)
    const stepBytes = out.error !== null ? 0 : out.rejected !== null ? 2 : legacyStepsJsonLength(out.steps, this.playerIds);
    const bytes = (typeof actionText === 'string' ? actionText.length : 0) + stepBytes;
    this.work.push({ fn, units: this.workUnits - unitsBefore, bytes });
    if (out.logs.length > 0) this.logs.push(...out.logs);
    if (out.error !== null) {
      throw new ModeError(`${fn}() threw: ${out.error}`, { stack: out.stack ?? undefined });
    }
    return { out, raw };
  }

  /** The prelude's sync: JSON `{ ok, steps }`, or a failure frame. */
  sync(playerIndex) {
    const started = performance.now();
    const unitsBefore = this.workUnits;
    const { raw } = this.#plain('sync', [playerIndex]);
    this.callTimes.push(performance.now() - started);
    if (!raw.startsWith('{')) {
      const out = decodeFrames(raw);
      throw new ModeError(`sync() threw: ${out.error}`, { stack: out.stack ?? undefined });
    }
    const { steps } = JSON.parse(raw);
    // Counted like every other call: a join or reconnect costs the server this much.
    this.work.push({ fn: 'sync', units: this.workUnits - unitsBefore, bytes: JSON.stringify(steps).length });
    return steps;
  }

  #plain(fn, args) {
    this.context.__bbFn = fn;
    this.context.__bbA = args[0];
    this.context.__bbB = args[1];
    this.context.__bbC = args[2];
    try {
      return { raw: callScript.runInContext(this.context, { timeout: this.maxCallMs }) };
    } catch (error) {
      if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new ModeError(`${fn}() exceeded the ${this.maxCallMs} ms time limit.`, { limit: 'maxCallMs' });
      }
      throw new ModeError(`${fn}() crashed the sandbox: ${error.message}`, { stack: error.stack });
    }
  }

  exportState() {
    return this.#plain('exportState', []).raw;
  }

  importState(snapshotJson) {
    const { raw } = this.#plain('importState', [snapshotJson]);
    if (raw !== '') throw new ModeError(`importState failed: ${decodeFrames(raw).error}`);
  }
}
