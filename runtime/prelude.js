// Sandbox prelude for community game modes (wire format v2).
//
// This is a plain script, not a module. It is evaluated first in a fresh V8 context (Node `vm` in the
// dev kit, ClearScript in the silo), then the bundled mode script is evaluated, which defines
// `globalThis.__bbMode`. The host then drives the mode only through the functions on `globalThis.__bb`, so the
// same prelude works unchanged on both hosts.
//
// Calls take plain arguments (numbers and strings) and return a string in the framed format described in
// devkit/wire.js: the empty string when nothing happened, otherwise `<tag><length>:<payload>` records. The host
// slices them without parsing any JSON, and an empty call costs almost nothing.
//
// Everything a mode can observe is deterministic: Math.random and Date are replaced by a seeded
// generator and the match clock, and there are no timers or I/O in the context.
(function () {
  'use strict';

  // Captured before any mode code runs. The mode shares this realm and may replace built-ins after this point;
  // the prelude only ever uses these copies, so it cannot be fooled into writing a wrong frame.
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  var toStr = String;
  var freeze = Object.freeze;
  var isArray = Array.isArray;
  var floor = Math.floor;
  var imul = Math.imul;
  var defineProperty = Object.defineProperty;
  var strSlice = Function.prototype.call.bind(String.prototype.slice);

  var RealDate = Date;
  var MATCH_EPOCH_MS = 1700000000000; // fixed, so Date values are stable across replays

  var mode = null;
  var state = null;
  var players = [];
  var timeMs = 0;
  var rngState = 1;

  // Per-call output buffers, filled by index so no Array.prototype method is ever called on them.
  var steps = [];
  var stepCount = 0;
  var logs = [];
  var logCount = 0;
  var limits = { maxStepsPerCall: 256, maxLogsPerCall: 32 };

  // mulberry32: small, fast, and fully described by one 32-bit integer of state.
  function nextFloat() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    var t = rngState;
    t = imul(t ^ (t >>> 15), t | 1);
    t ^= t + imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  var rng = freeze({
    next: nextFloat,
    int: function (maxExclusive) {
      return floor(nextFloat() * maxExclusive);
    },
    pick: function (array) {
      return array[floor(nextFloat() * array.length)];
    },
    shuffle: function (array) {
      for (var i = array.length - 1; i > 0; i--) {
        var j = floor(nextFloat() * (i + 1));
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
  // Without this, `new Date().constructor` is the real Date and `.now()` on it reads the wall clock.
  RealDate.prototype.constructor = MatchDate;
  MatchDate.now = function () {
    return MATCH_EPOCH_MS + timeMs;
  };
  MatchDate.parse = RealDate.parse;
  MatchDate.UTC = RealDate.UTC;
  globalThis.Date = MatchDate;
  // Intl formats "now" when called without a date, which is another way to read the wall clock.
  delete globalThis.Intl;

  // Binary buffers are allocated outside the JavaScript heap, where the host's heap limit cannot see them.
  // State is JSON, so a mode has no need for them; removing them keeps everything a mode holds inside the
  // measured heap. Nothing else in the language hands out a buffer once these names are gone.
  // WeakRef and FinalizationRegistry let a script observe garbage collection, which depends on everything
  // else in the heap: gone too, so a mode cannot behave differently from one run to the next.
  [
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WebAssembly',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
    'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
    'WeakRef', 'FinalizationRegistry',
  ].forEach(function (name) {
    delete globalThis[name];
  });

  // No code from strings. The dev kit host already refuses it; the server host has no such switch, so the
  // entry points are closed here to make both behave the same: eval is gone, and every function constructor
  // (plain, async, generator, async generator) throws.
  (function () {
    var RealFunction = Function;
    function blocked() {
      throw new EvalError('Code generation from strings is not available to modes.');
    }
    blocked.prototype = RealFunction.prototype;
    var prototypes = [
      RealFunction.prototype,
      Object.getPrototypeOf(function* () {}),
      Object.getPrototypeOf(async function () {}),
      Object.getPrototypeOf(async function* () {}),
    ];
    for (var i = 0; i < prototypes.length; i++) {
      defineProperty(prototypes[i], 'constructor', { value: blocked, writable: false, configurable: false, enumerable: false });
    }
    defineProperty(globalThis, 'Function', { value: blocked, writable: false, configurable: false, enumerable: false });
    defineProperty(globalThis, 'eval', { value: undefined, writable: false, configurable: false, enumerable: false });
  })();

  function safeStringify(value) {
    try {
      var text = stringify(value);
      return text === undefined ? toStr(value) : text;
    } catch (e) {
      return toStr(value);
    }
  }

  function pushLog(args) {
    if (logCount >= limits.maxLogsPerCall) return;
    var line = '';
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (i > 0) line += ' ';
      line += typeof a === 'string' ? a : safeStringify(a);
    }
    logs[logCount++] = strSlice(line, 0, 500);
  }

  var consoleShim = {
    log: function () { pushLog(arguments); },
    info: function () { pushLog(arguments); },
    warn: function () { pushLog(arguments); },
    error: function () { pushLog(arguments); },
    debug: function () {},
  };
  globalThis.console = consoleShim;

  function playerIndexOf(id) {
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === id) return i;
    }
    return -2; // nobody: a step to an unknown player is dropped
  }

  function emit(step, options) {
    if (stepCount >= limits.maxStepsPerCall) {
      throw new Error('Step limit exceeded: more than ' + limits.maxStepsPerCall + ' steps emitted in one call.');
    }
    var to = options && options.to != null ? playerIndexOf(toStr(options.to)) : -1;
    // Kept by reference and serialized when the call ends, as before: a step changed after emit() goes out changed.
    steps[stepCount++] = { to: to, step: step };
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
    stepCount = 0;
    logCount = 0;
    if (typeof newTimeMs === 'number' && newTimeMs > timeMs) timeMs = newTimeMs;
  }

  function record(tag, payload) {
    return tag + payload.length + ':' + payload;
  }

  function logRecords() {
    var out = '';
    for (var i = 0; i < logCount; i++) out += record('L', logs[i]);
    return out;
  }

  function finish() {
    var result = mode.result(state);
    if (stepCount === 0 && logCount === 0 && !result) return '';

    var out = '';
    for (var i = 0; i < stepCount; i++) {
      var entry = steps[i];
      if (entry.to === -2) continue;
      var json = stringify(entry.step);
      if (json === undefined) json = 'null';
      out += entry.to === -1 ? record('B', json) : record('P', entry.to + ',' + json);
    }
    out += logRecords();
    if (result) {
      var resultJson = stringify(result);
      // The host only ever sees the JSON, so "over" means truthy after a JSON round trip, as it always did.
      if (resultJson !== undefined && parse(resultJson)) out += record('R', resultJson);
    }
    return out;
  }

  // A rejection is the mode saying "this action is illegal". Anything else thrown is a bug in the mode.
  function failure(error) {
    if (error && error.__bbReject === true) {
      return logRecords() + record('X', toStr(error.reason || 'rejected'));
    }
    var out = logRecords() + record('E', toStr((error && error.message) || error));
    if (error && error.stack) out += record('K', strSlice(toStr(error.stack), 0, 2000));
    return out;
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

  function freezePlayers(list) {
    var copy = [];
    for (var i = 0; i < list.length; i++) copy[i] = freeze(list[i]);
    return freeze(copy);
  }

  function playerAt(index) {
    var player = players[index];
    if (!player) throw new Error('Unknown player index ' + index + '.');
    return player.id;
  }

  var api = freeze({
    // inputJson: { players: [{id, name, isBot}], seed, limits? }
    setup: function (inputJson) {
      try {
        requireMode();
        var input = parse(inputJson);
        players = freezePlayers(input.players);
        rngState = input.seed | 0;
        timeMs = 0;
        if (input.limits && input.limits.maxStepsPerCall) limits.maxStepsPerCall = input.limits.maxStepsPerCall;
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

    // playerIndex: the player's place in the setup list; actionText: the action as JSON text, or undefined/null
    // for none. The text is parsed here, so a client can never splice anything into the host's call.
    action: function (playerIndex, actionText, newTimeMs) {
      try {
        var action;
        if (actionText !== undefined && actionText !== null) {
          try {
            action = parse(actionText);
          } catch (e) {
            return record('X', 'invalid_action');
          }
        }
        var playerId = playerAt(playerIndex);
        begin(newTimeMs);
        mode.onAction(state, action, makeContext(playerId));
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    tick: function (dtMs, newTimeMs) {
      try {
        begin(newTimeMs);
        if (typeof mode.onTick === 'function') mode.onTick(state, dtMs, makeContext(null));
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    // status: 'disconnected' | 'reconnected' | 'forfeited'
    status: function (playerIndex, status, newTimeMs) {
      try {
        var playerId = playerAt(playerIndex);
        begin(newTimeMs);
        if (typeof mode.onPlayerStatus === 'function') {
          mode.onPlayerStatus(state, playerId, status, makeContext(playerId));
        }
        return finish();
      } catch (e) {
        return failure(e);
      }
    },

    // Read-only: must not change state or consume randomness. Returns JSON (rare, so it keeps the simple format):
    // { ok: true, steps } or a failure frame.
    sync: function (playerIndex) {
      try {
        var playerId = playerAt(playerIndex);
        stepCount = 0;
        logCount = 0;
        var savedRng = rngState;
        var syncSteps = mode.sync(state, playerId);
        rngState = savedRng;
        if (!isArray(syncSteps)) throw new Error('sync() must return an array of steps.');
        return stringify({ ok: true, steps: syncSteps });
      } catch (e) {
        return failure(e);
      }
    },

    // Everything needed to continue this match in a fresh sandbox.
    exportState: function () {
      return stringify({ state: state, rng: rngState, timeMs: timeMs, players: players });
    },

    // Returns the empty string on success, a failure frame otherwise.
    importState: function (snapshotJson) {
      try {
        requireMode();
        var snapshot = parse(snapshotJson);
        state = snapshot.state;
        rngState = snapshot.rng | 0;
        timeMs = snapshot.timeMs;
        players = freezePlayers(snapshot.players);
        return '';
      } catch (e) {
        return failure(e);
      }
    },
  });

  // Not writable or configurable, so a mode cannot replace the host entry points.
  defineProperty(globalThis, '__bb', { value: api, writable: false, configurable: false, enumerable: false });
})();
