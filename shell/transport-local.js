// Transport to the dev kit server: Server-Sent Events down, POST up. No dependencies.

export function localTransport({ baseUrl = '', playerId }) {
  let source = null;
  const query = `player=${encodeURIComponent(playerId)}`;

  const transport = {
    onMessage: null,
    onOpen: null,
    onClose: null,

    connect() {
      if (source) return;
      source = new EventSource(`${baseUrl}/api/stream?${query}`);
      source.onopen = () => transport.onOpen?.();
      source.onmessage = (event) => transport.onMessage?.(JSON.parse(event.data));
      source.onerror = () => {
        // EventSource retries by itself; report the drop once and let it reconnect.
        if (source && source.readyState !== EventSource.OPEN) transport.onClose?.();
      };
    },

    close() {
      if (!source) return;
      source.close();
      source = null;
      transport.onClose?.();
    },

    send(message) {
      fetch(`${baseUrl}/api/send?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      }).catch(() => {});
    },
  };
  return transport;
}
