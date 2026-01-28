/**
 * Keep-alive mechanism - Previne que o Service Worker durma
 */

import { mcpWebSocket, automationSessions, config } from './state.js';
import { connectToMCPServer } from './websocket-client.js';

const KEEP_ALIVE_ALARM = 'keep-alive';

/**
 * Cria alarm para manter o SW ativo
 */
export async function setupKeepAlive() {
  try {
    await chrome.alarms.create(KEEP_ALIVE_ALARM, {
      periodInMinutes: config.KEEP_ALIVE_INTERVAL
    });
    console.log('[Universal MCP] Keep-alive alarm created');
  } catch (e) {
    console.error('[Universal MCP] Failed to create keep-alive alarm:', e);
  }
}

/**
 * Handler do alarm - mantém o SW ativo
 */
export function handleAlarm(alarm) {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    if (mcpWebSocket && mcpWebSocket.readyState === WebSocket.OPEN) {
      mcpWebSocket.send(JSON.stringify({
        type: 'health_check',
        sessionId: '__background__',
        data: {
          activeSessions: automationSessions.size,
          keepAlive: true,
          timestamp: Date.now()
        }
      }));
    } else {
      connectToMCPServer();
    }
  }
}

/**
 * Inicializa o listener do alarm
 */
export function initKeepAlive() {
  chrome.alarms.onAlarm.addListener(handleAlarm);
  setupKeepAlive();
}
