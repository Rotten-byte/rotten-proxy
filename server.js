
function addWebSocketListener(ws, eventName, handler) {
  if (typeof ws.on === 'function') {
    ws.on(eventName, handler);
    return;
  }

  if (typeof ws.addEventListener === 'function') {
  }

  if (typeof ws.on === 'function') ws.on(eventName, handler);
}
  lastStreamElementsMessage: null,
  lastStreamElementsError: null,
  lastStreamElementsClose: null,
  lastStreamElementsTip: null,
    lastStreamElementsMessage: diagnostics.lastStreamElementsMessage,
    lastStreamElementsError: diagnostics.lastStreamElementsError,
    lastStreamElementsClose: diagnostics.lastStreamElementsClose,
    lastStreamElementsTip: diagnostics.lastStreamElementsTip,
      console.error('StreamElements WS error:', message);
      diagnostics.lastStreamElementsError = {
        at: new Date().toISOString(),
        message,
      };
      emitStreamElementsStatus({

    if (typeof ws.on === 'function') {
      ws.on('unexpected-response', (_request, response) => {
        if (state.streamElementsWs !== ws) return;
        const message = `StreamElements respuesta inesperada HTTP ${response && response.statusCode}`;
        diagnostics.lastStreamElementsError = {
          at: new Date().toISOString(),
          message,
          statusCode: response && response.statusCode,
          headers: response && response.headers,
        };
        emitStreamElementsStatus({
          ok: false,
          status: 'unexpected_response',
          message,
          statusCode: response && response.statusCode,
        });
      });
    }

    addWebSocketListener(ws, 'close', (code, reasonOrEvent) => {
      console.warn(message);
      diagnostics.lastStreamElementsClose = {
        at: new Date().toISOString(),
        code: closeCode || null,
        reason,
      };
      scheduleStreamElementsReconnect(message);
