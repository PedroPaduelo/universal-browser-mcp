/**
 * WebSocket connection manager for content script bridge
 */

/**
 * Create and connect a WebSocket to the bridge server
 */
export function createWebSocket(sessionId, callbacks) {
  const ws = new WebSocket('ws://localhost:3002');

  ws.onopen = () => {
    console.log(`[Universal MCP] Connected to bridge server (session: ${sessionId})`);
    callbacks.onConnected();

    ws.send(JSON.stringify({
      type: 'browser_ready',
      sessionId,
      data: {
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      }
    }));
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.sessionId && message.sessionId !== sessionId) {
        console.log(`[Universal MCP] Ignoring message for different session: ${message.sessionId}`);
        return;
      }
      callbacks.onMessage(message);
    } catch (error) {
      console.error('[Universal MCP] Error parsing message:', error);
    }
  };

  ws.onclose = () => {
    console.log('[Universal MCP] Connection closed');
    callbacks.onDisconnected();
  };

  ws.onerror = (error) => {
    console.error('[Universal MCP] WebSocket error:', error);
    callbacks.onError();
  };

  return ws;
}

/**
 * Calculate reconnect delay with exponential backoff
 * 500ms, 1s, 2s, 4s, max 10s
 */
export function getReconnectDelay(attempt) {
  return Math.min(500 * Math.pow(2, attempt - 1), 10000);
}
