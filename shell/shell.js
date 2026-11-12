// Host shell: the trusted page around an untrusted mode client.
//
// The shell owns the connection to the server. The mode runs in a sandboxed iframe with an opaque
// origin and no network access, and only ever sees messages relayed through postMessage. The shell
// also enforces ordering: step batches reach the mode in sequence with no gaps, and when one is
// missing the shell asks the server for a sync instead of passing a broken stream on.

// The mode document is self-contained (built by the dev kit), so it needs no network at all:
// scripts and styles are inline, assets are data URIs.
const MODE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * @param {object} options
 * @param {HTMLIFrameElement} options.frame empty iframe element to host the mode
 * @param {string} options.modeHtml the mode's built, self-contained client document
 * @param {{ send(msg: object): void, onMessage: Function|null, onOpen: Function|null, onClose: Function|null, connect(): void, close(): void }} options.transport
 * @param {(event: string, detail?: object) => void} [options.onEvent] 'sync' | 'gap' | 'result' | 'aborted' | 'exit' | 'open' | 'close' | 'blocked'
 */
export function createShell({ frame, modeHtml, transport, onEvent = () => {} }) {
  let lastSeq = -1;
  let awaitingSync = true;
  let frameReady = false;
  let connected = false;
  let loads = 0;
  let blocked = false;

  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  // The policy goes first, ahead of anything the mode wrote, so the mode cannot comment it out.
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${MODE_CSP}">` +
    modeHtml.replace(/^\s*<!doctype[^>]*>/i, '');

  // A sandboxed frame can still navigate itself, which would be a way to send data out in a URL.
  // The mode document never needs to navigate, so a second load means it tried: shut it down.
  frame.addEventListener('load', () => {
    if (++loads < 2) return;
    blocked = true;
    frame.removeAttribute('srcdoc');
    frame.src = 'about:blank';
    onEvent('blocked', { reason: 'The mode tried to navigate away from its document.' });
  });

  function toMode(message) {
    if (blocked) return;
    // The sandboxed frame has an opaque origin, so '*' is the only target that can reach it.
    frame.contentWindow.postMessage(message, '*');
  }

  function requestSync() {
    awaitingSync = true;
    if (connected) transport.send({ kind: 'sync' });
  }

  window.addEventListener('message', (event) => {
    if (blocked || event.source !== frame.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.bb === 'ready') {
      frameReady = true;
      requestSync();
    } else if (msg.bb === 'action') {
      if (typeof msg.actionId !== 'string' || msg.actionId.length > 32) return;
      if (connected) transport.send({ kind: 'action', actionId: msg.actionId, action: msg.action });
    } else if (msg.bb === 'exit') {
      onEvent('exit');
    }
  });

  transport.onOpen = () => {
    connected = true;
    onEvent('open');
    if (frameReady) requestSync();
  };

  transport.onClose = () => {
    connected = false;
    onEvent('close');
  };

  transport.onMessage = (msg) => {
    switch (msg.kind) {
      case 'sync':
        if (!frameReady) return;
        lastSeq = msg.seq;
        awaitingSync = false;
        toMode(msg);
        onEvent('sync', { seq: msg.seq });
        break;
      case 'steps':
        if (awaitingSync || msg.seq <= lastSeq) return;
        if (msg.seq !== lastSeq + 1) {
          onEvent('gap', { expected: lastSeq + 1, got: msg.seq });
          requestSync();
          return;
        }
        lastSeq = msg.seq;
        toMode(msg);
        break;
      case 'rejected':
        toMode(msg);
        break;
      case 'result':
        toMode(msg);
        onEvent('result', msg.result);
        break;
      case 'aborted':
        onEvent('aborted', { reason: msg.reason });
        break;
    }
  };

  transport.connect();

  return {
    get lastSeq() { return lastSeq; },
    get connected() { return connected; },
    disconnect() { transport.close(); },
    reconnect() { transport.connect(); },
  };
}
