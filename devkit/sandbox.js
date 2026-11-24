// Node `vm` host for a mode: the dev kit twin of the ClearScript sandbox used in the silo.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { communityRoot, limits as defaultLimits } from './build.js';
import { counterName, instrument } from './work.js';

const preludeSource = readFileSync(path.join(communityRoot, 'runtime', 'prelude.js'), 'utf8');
const preludeScript = new vm.Script(preludeSource, { filename: 'prelude.js' });
const callScript = new vm.Script('__bb[__bbFn](__bbArg)', { filename: 'host-call.js' });

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
    /** With countWork: one { fn, units } per call, in order. */
    this.work = [];
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

  /** Calls one prelude entry point. Returns the parsed output and the raw JSON (used for hashing). */
  call(fn, input) {
    this.context.__bbFn = fn;
    this.context.__bbArg = input === undefined ? undefined : JSON.stringify(input);
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
    const out = JSON.parse(raw);
    // The data a mode is answerable for: the steps it emits and the actions its clients send. The fixed
    // wrapping around them (player ids, clock, envelope) is the platform's and the same for every mode.
    const bytes = (input?.action === undefined ? 0 : JSON.stringify(input.action).length)
      + (Array.isArray(out.steps) ? JSON.stringify(out.steps).length : 0);
    this.work.push({ fn, units: this.workUnits - unitsBefore, bytes });
    if (out.logs) this.logs.push(...out.logs);
    if (out.ok === false) {
      throw new ModeError(`${fn}() threw: ${out.error}`, { stack: out.stack });
    }
    return { out, raw };
  }

  exportState() {
    this.context.__bbFn = 'exportState';
    this.context.__bbArg = undefined;
    return callScript.runInContext(this.context, { timeout: this.maxCallMs });
  }

  importState(snapshotJson) {
    this.context.__bbFn = 'importState';
    this.context.__bbArg = snapshotJson;
    const out = JSON.parse(callScript.runInContext(this.context, { timeout: this.maxCallMs }));
    if (out.ok === false) throw new ModeError(`importState failed: ${out.error}`);
  }
}
