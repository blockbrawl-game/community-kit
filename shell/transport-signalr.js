// Transport to the real gateway: a SignalR connection to /modehub, authenticated by a mode ticket.
//
// The ticket is the only credential the shell holds. It names one player and one match, so the hub
// needs nothing else from the client. Server messages arrive as JSON text on `Message`, in the wire
// protocol documented at the top of devkit/match.js.
//
// `signalR` is the @microsoft/signalr browser library; the page loads it and passes it in, so the
// shell itself has no dependency on where it comes from.

const RETRY_DELAYS_MS = [0, 1000, 2000, 5000, 10000, 10000, 10000, 10000];
const FIRST_CONNECT_RETRY_MS = 2000;

export function signalRTransport({ signalR, hubUrl, ticket }) {
  let connection = null;
  let wanted = false;

  const transport = {
    onMessage: null,
    onOpen: null,
    onClose: null,

    connect() {
      wanted = true;
      if (connection) return;

      const current = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, { accessTokenFactory: () => ticket })
        .withAutomaticReconnect(RETRY_DELAYS_MS)
        .configureLogging(signalR.LogLevel.Warning)
        .build();
      connection = current;

      current.on('Message', (json) => {
        if (connection === current) transport.onMessage?.(JSON.parse(json));
      });
      current.onreconnecting(() => {
        if (connection === current) transport.onClose?.();
      });
      // A reconnect is a new connection for the server: it joins again and the shell asks for a sync.
      current.onreconnected(() => {
        if (connection === current) transport.onOpen?.();
      });
      current.onclose(() => {
        if (connection !== current) return;
        connection = null;
        transport.onClose?.();
        if (wanted) setTimeout(() => { if (wanted) transport.connect(); }, FIRST_CONNECT_RETRY_MS);
      });

      current.start().then(
        () => { if (connection === current) transport.onOpen?.(); },
        () => {
          if (connection !== current) return;
          connection = null;
          transport.onClose?.();
          if (wanted) setTimeout(() => { if (wanted) transport.connect(); }, FIRST_CONNECT_RETRY_MS);
        },
      );
    },

    close() {
      wanted = false;
      const current = connection;
      connection = null;
      if (!current) return;
      current.stop();
      transport.onClose?.();
    },

    /** Leaves the match for good (the player forfeits), then closes. Resolves when the server has been told. */
    async leave() {
      wanted = false;
      const current = connection;
      connection = null;
      if (!current) return;
      try {
        if (current.state === signalR.HubConnectionState.Connected) await current.invoke('Leave');
      } catch {
        // The connection is going away either way; a lost Leave becomes a disconnect on the server.
      }
      current.stop();
      transport.onClose?.();
    },

    send(message) {
      const current = connection;
      if (!current || current.state !== signalR.HubConnectionState.Connected) return;
      if (message.kind === 'sync') {
        current.invoke('RequestSync').catch(() => {});
      } else if (message.kind === 'action') {
        current.invoke('SendAction', message.actionId, JSON.stringify(message.action ?? null)).catch(() => {});
      }
    },
  };
  return transport;
}
