// Client-side SDK for community modes. Runs inside the sandboxed mode iframe.
//
// The mode never talks to the network. Everything goes through postMessage to the host shell,
// which owns the connection, orders step batches and requests a sync when one is missing.

const SESSION = Math.floor(Math.random() * 0xffffff).toString(36);

/**
 * Connects the mode client to the host shell.
 * @param {import('./types').ModeClientOptions} options
 * @returns {import('./types').GameHandle}
 */
export function connect(options) {
  const { model, onChange, onRejected, onResult } = options;
  for (const name of ['applySync', 'applySteps', 'snapshot']) {
    if (!model || typeof model[name] !== 'function') {
      throw new Error(`connect: model is missing required function "${name}".`);
    }
  }

  let nextAction = 1;
  let serverTimeMs = 0;
  let receivedAt = performance.now();

  const game = {
    me: null,
    players: [],
    ready: false,
    /** Sends an action to the server. Returns the id that comes back as `ackActionId` or in `onRejected`. */
    send(action) {
      const actionId = `${SESSION}-${nextAction++}`;
      parent.postMessage({ bb: 'action', actionId, action }, '*');
      return actionId;
    },
    /** Estimated server match clock, for countdowns and interpolation. */
    timeMs() {
      return serverTimeMs + (performance.now() - receivedAt);
    },
    /** Asks the host to close the mode (for example from a "back to lobby" button). */
    exit() {
      parent.postMessage({ bb: 'exit' }, '*');
    },
  };

  function stamp(timeMs) {
    if (typeof timeMs === 'number') {
      serverTimeMs = timeMs;
      receivedAt = performance.now();
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.kind) {
      case 'sync':
        stamp(msg.timeMs);
        game.me = msg.info.you;
        game.players = msg.info.players;
        game.ready = true;
        model.applySync(msg.steps, msg.info);
        if (onChange) onChange({ kind: 'sync', steps: msg.steps });
        break;
      case 'steps':
        stamp(msg.timeMs);
        model.applySteps(msg);
        if (onChange) onChange(msg);
        break;
      case 'rejected':
        if (typeof model.onRejected === 'function') model.onRejected(msg.actionId, msg.reason);
        if (onRejected) onRejected(msg.actionId, msg.reason);
        break;
      case 'result':
        if (onResult) onResult(msg.result);
        break;
    }
  });

  parent.postMessage({ bb: 'ready' }, '*');
  return game;
}
