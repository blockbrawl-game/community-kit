// Client-side SDK for offline community modes. Runs inside the sandboxed mode iframe.
//
// An offline mode has no server: the whole game is this client. It still never talks to the
// network. The host shell tells it who is playing, and the mode tells the shell when it is over.

/**
 * Connects an offline mode to the host shell.
 * @param {{ onReady?: (game: object) => void }} [options]
 * @returns {{ me: string|null, players: object[], ready: boolean, finish(result: { score: number }): void, exit(): void }}
 */
export function connectOffline(options = {}) {
  const game = {
    me: null,
    players: [],
    ready: false,
    /** Reports the end of a run. The host shows it; it is not verified, so it earns nothing. */
    finish(result) {
      parent.postMessage({ bb: 'result', result: { score: Number(result?.score) || 0 } }, '*');
    },
    /** Asks the host to close the mode (for example from a "back" button). */
    exit() {
      parent.postMessage({ bb: 'exit' }, '*');
    },
  };

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.kind !== 'sync' || game.ready) return;

    game.me = msg.info.you;
    game.players = msg.info.players;
    game.ready = true;
    if (options.onReady) options.onReady(game);
  });

  parent.postMessage({ bb: 'ready' }, '*');
  return game;
}
