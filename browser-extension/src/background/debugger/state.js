/**
 * Estado do debugger compartilhado entre módulos
 */

import { debuggerState, config } from '../state.js';

/**
 * Inicializa o estado do debugger para uma sessão
 */
export function initDebuggerState(sessionId) {
  if (!debuggerState.has(sessionId)) {
    debuggerState.set(sessionId, {
      attached: false,
      networkEnabled: false,
      consoleEnabled: false,
      wsEnabled: false,
      networkLogs: [],
      consoleLogs: [],
      wsFrames: [],
      pendingRequests: new Map(),
      maxLogs: config.MAX_LOGS
    });
  }
  return debuggerState.get(sessionId);
}

/**
 * Retorna o estado do debugger para uma sessão
 */
export function getDebuggerState(sessionId) {
  return debuggerState.get(sessionId);
}

/**
 * Remove o estado do debugger para uma sessão
 */
export function removeDebuggerState(sessionId) {
  debuggerState.delete(sessionId);
}
