/**
 * WebSocket client para conexão com MCP Server
 */

import { mcpWebSocket, setMcpWebSocket, automationSessions, config } from './state.js';
import { handleMCPMessage } from './message-handler.js';

let reconnectAttempts = 0;
let isConnecting = false;

/**
 * Conecta ao servidor MCP via WebSocket
 */
export function connectToMCPServer() {
  if (isConnecting) {
    console.log('[Universal MCP] Connection already in progress...');
    return;
  }

  if (mcpWebSocket && mcpWebSocket.readyState === WebSocket.OPEN) {
    console.log('[Universal MCP] Already connected to MCP server');
    return;
  }

  if (mcpWebSocket) {
    try {
      mcpWebSocket.close();
    } catch (e) {}
    setMcpWebSocket(null);
  }

  isConnecting = true;
  console.log('[Universal MCP] Connecting to MCP server...');

  try {
    const ws = new WebSocket(config.WS_URL);

    ws.onopen = () => {
      console.log('[Universal MCP] Connected to MCP server!');
      isConnecting = false;
      reconnectAttempts = 0;

      ws.send(JSON.stringify({
        type: 'background_ready',
        sessionId: '__background__',
        data: {
          extensionId: chrome.runtime.id,
          timestamp: Date.now()
        }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMCPMessage(message);
      } catch (error) {
        console.error('[Universal MCP] Error parsing MCP message:', error);
      }
    };

    ws.onclose = (event) => {
      console.log(`[Universal MCP] Disconnected from MCP server (code: ${event.code})`);
      isConnecting = false;
      setMcpWebSocket(null);

      if (event.code !== 1000) {
        scheduleReconnect();
      }
    };

    ws.onerror = (error) => {
      console.error('[Universal MCP] WebSocket error:', error);
      isConnecting = false;
    };

    setMcpWebSocket(ws);

  } catch (error) {
    console.error('[Universal MCP] Failed to connect:', error);
    isConnecting = false;
    scheduleReconnect();
  }
}

/**
 * Agenda reconexão com backoff exponencial
 */
function scheduleReconnect() {
  if (reconnectAttempts >= config.MAX_RECONNECT_ATTEMPTS) {
    console.log('[Universal MCP] Max reconnect attempts reached, will retry on next event');
    reconnectAttempts = 0;
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
  console.log(`[Universal MCP] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  setTimeout(connectToMCPServer, delay);
}

/**
 * Envia mensagem para o MCP Server
 */
export function sendToMCP(message) {
  if (mcpWebSocket && mcpWebSocket.readyState === WebSocket.OPEN) {
    mcpWebSocket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Envia resposta para uma requisição
 */
export function sendResponse(requestId, success, data, error = null) {
  return sendToMCP({
    type: 'response',
    requestId,
    sessionId: '__background__',
    success,
    data,
    error
  });
}
