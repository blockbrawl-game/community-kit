// Sandbox prelude for community game modes.
//
// This is a plain script, not a module. It is evaluated first in a fresh V8 context (Node `vm` in the
// dev kit, ClearScript in the silo), then the bundled mode script is evaluated, which defines
// `globalThis.__bbMode`. The host then drives the mode only through the string-in / string-out
// functions on `globalThis.__bb`, so the same prelude works unchanged on both hosts.
//
// Everything a mode can observe is deterministic: Math.random and Date are replaced by a seeded
// generator and the match clock, and there are no timers or I/O in the context.
(function () {
  'use strict';

  var RealDate = Date;
  var MATCH_EPOCH_MS = 1700000000000; // fixed, so Date values are stable across replays

  var mode = null;
  var state = null;
  var players = [];
  var timeMs = 0;
  var rngState = 1;

  // Per-call output buffers.
  var steps = [];
  var logs = [];
  var limits = { maxStepsPerCall: 256, maxLogsPerCall: 32 };

  // mulberry32: small, fast, and fully described by one 32-bit integer of state.
  function nextFloat() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    var t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  var rng = Object.freeze({
    next: nextFloat,
    int: function (maxExclusive) {
      return Math.floor(nextFloat() * maxExclusive);
    },
    pick: function (array) {
      return array[Math.floor(nextFloat() * array.length)];
    },
    shuffle: function (array) {
      for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(nextFloat() * (i + 1));
        var tmp = array[i];
        array[i] = array[j];
        array[j] = tmp;
      }
      return array;
    },
  });

  Math.random = nextFloat;

  function MatchDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!new.target) return new RealDate(MATCH_EPOCH_MS + timeMs).toString();
    if (args.length === 0) return new RealDate(MATCH_EPOCH_MS + timeMs);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
  }
  MatchDate.prototype = RealDate.prototype;
  MatchDate.now = function () {
    return MATCH_EPOCH_MS + timeMs;
  };
  MatchDate.parse = RealDate.parse;
  MatchDate.UTC = RealDate.UTC;
  globalThis.Date = MatchDate;

  // Binary buffers are allocated outside the JavaScript heap, where the host's heap limit cannot see them.
  // State is JSON, so a mode has no need for them; removing them keeps everything a mode holds inside the
  // measured heap. Nothing else in the language hands out a buffer once these names are gone.
  [
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WebAssembly',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
    'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  ].forEach(function (name) {
    delete globalThis[name];
  });

  function pushLog(args) {
    if (logs.length >= limits.maxLogsPerCall) return;
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      parts.push(typeof a === 'string' ? a : safeStringify(a));
    }
    logs.push(parts.join(' ').slice(0, 500));
  }

  function safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  var consoleShim = {
    log: function () { pushLog(arguments); },
    info: function () { pushLog(arguments); },
    warn: function () { pushLog(arguments); },
    error: function () { pushLog(arguments); },
    debug: function () {},
  };
  globalThis.console = consoleShim;

  function emit(step, options) {
    if (steps.length >= limits.maxStepsPerCall) {
      throw new Error('Step limit exceeded: more than ' + limits.maxStepsPerCall + ' steps emitted in one call.');
    }
    var to = options && options.to != null ? String(options.to) : null;
    steps.push({ to: to, step: step });
  }

  function makeContext(playerId) {
    return {
      players: players,
      playerId: playerId == null ? null : playerId,
      rng: rng,
      timeMs: timeMs,
      emit: emit,
      log: function () { pushLog(arguments); },
    };
  }

  function begin(newTimeMs) {
    steps = [];
    logs = [];
    if (typeof newTimeMs === 'number' && newTimeMs > timeMs) timeMs = newTimeMs;
  }

  function finish(extra) {
    var out = { ok: true, steps: steps, result: null };
    if (logs.length > 0) out.logs = logs;
    if (extra) {
      for (var key in extra) out[key] = extra[key];
    }
    var result = mode.result(state);
    out.result = result == null ? null : result;
    return JSON.stringify(out);
  }

  // A rejection is the mode saying "this action is illegal". Anything else thrown is a bug in the mode.
  function failure(error) {
    var out;
    if (error && error.__bbReject === true) {
      out = { ok: true, rejected: String(error.reason || 'rejected'), steps: [], result: null };
    } else {
      out = {
        ok: false,
        error: String((error && error.message) || error),
        stack: error && error.stack ? String(error.stack).slice(0, 2000) : undefined,
      };
    }
    if (logs.length > 0) out.logs = logs;
    return JSON.stringify(out);
  }

  function requireMode() {
    if (mode) return;
    var candidate = globalThis.__bbMode;
    if (candidate && candidate.default) candidate = candidate.default;
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Mode bundle did not export a mode. Use `export default defineMode({...})` in server.js.');
    }
    var required = ['setup', 'onAction', 'sync', 'result'];
    for (var i = 0; i < required.length; i++) {
      if (typeof candidate[required[i]] !== 'function') {
        throw new Error('Mode is missing required function `' + required[i] + '`.');
      }
    }
    mode = candidate;
  }

  var api = Object.freeze({
    // input: { players: [{id, name, isBot}], seed, limits? }
    setup: function (inputJson) {
      try {
        requireMode();
        var input = JSON.parse(inputJson);
        players = Object.freeze(input.players.map(function (p) { return Object.freeze(p); }));
        rngState = input.seed | 0;
        timeMs = 0;
        if (input.limits) {
          if (input.limits.maxStepsPerCall) limits.maxStepsPerCall = input.limits.maxStepsPerCall;
        }
        begin(0);
        state = mode.setup(makeContext(null));
        if (state === undefined || state === null || typeof state !== 'object') {
          throw new Error('setup() must return the initial state object.');
        }
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    // input: { playerId, action, timeMs }
    action: function (inputJson) {
      try {
        var input = JSON.parse(inputJson);
        begin(input.timeMs);
        mode.onAction(state, input.action, makeContext(input.playerId));
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    // input: { dtMs, timeMs }
    tick: function (inputJson) {
      try {
        var input = JSON.parse(inputJson);
        begin(input.timeMs);
        if (typeof mode.onTick === 'function') mode.onTick(state, input.dtMs, makeContext(null));
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    // input: { playerId, status, timeMs }   status: 'disconnected' | 'reconnected' | 'forfeited'
    status: function (inputJson) {
      try {
        var input = JSON.parse(inputJson);
        begin(input.timeMs);
        if (typeof mode.onPlayerStatus === 'function') {
          mode.onPlayerStatus(state, input.playerId, input.status, makeContext(input.playerId));
        }
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    // input: { playerId }   Read-only: must not change state or consume randomness.
    sync: function (inputJson) {
      try {
        var input = JSON.parse(inputJson);
        steps = [];
        logs = [];
        var savedRng = rngState;
        var syncSteps = mode.sync(state, input.playerId);
        rngState = savedRng;
        if (!Array.isArray(syncSteps)) throw new Error('sync() must return an array of steps.');
        return JSON.stringify({ ok: true, steps: syncSteps });
      } catch (e) {
        return failure(e);
      }
    },

    // Everything needed to continue this match in a fresh sandbox.
    exportState: function () {
      return JSON.stringify({ state: state, rng: rngState, timeMs: timeMs, players: players });
    },

    importState: function (snapshotJson) {
      try {
        requireMode();
        var snapshot = JSON.parse(snapshotJson);
        state = snapshot.state;
        rngState = snapshot.rng | 0;
        timeMs = snapshot.timeMs;
        players = Object.freeze(snapshot.players.map(function (p) { return Object.freeze(p); }));
        return JSON.stringify({ ok: true });
      } catch (e) {
        return failure(e);
      }
    },
  });

  // Not writable or configurable, so a mode cannot replace the host entry points.
  Object.defineProperty(globalThis, '__bb', { value: api, writable: false, configurable: false, enumerable: false });
})();
