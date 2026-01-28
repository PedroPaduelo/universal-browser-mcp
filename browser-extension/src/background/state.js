/**
 * Estado global compartilhado entre módulos do background
 */

// Armazena sessões ativas: sessionId -> { windowId, tabId, createdAt }
export const automationSessions = new Map();

// Mapeia windowId -> sessionId para lookup reverso
export const windowToSession = new Map();

// Estado do debugger por sessão
export const debuggerState = new Map();

// Conexão WebSocket com o servidor MCP
export let mcpWebSocket = null;

export function setMcpWebSocket(ws) {
  mcpWebSocket = ws;
}

// Configurações
export const config = {
  WS_URL: 'ws://localhost:3002',
  MAX_RECONNECT_ATTEMPTS: 20,
  KEEP_ALIVE_INTERVAL: 0.4, // minutos
  MAX_LOGS: 1000
};
