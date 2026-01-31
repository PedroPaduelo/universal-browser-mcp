/**
 * Debugger module - Orchestrator
 */

import { automationSessions } from '../state.js';
import { getDebuggerState } from './state.js';

// Import all debugger functions
import { attachDebugger, detachDebugger, getDebuggerStatus } from './core.js';
import { enableNetworkCapture, getNetworkLogs, handleNetworkRequest, handleNetworkResponse, handleLoadingFinished, handleLoadingFailed } from './network.js';
import { enableConsoleCapture, getConsoleLogs, handleConsoleAPICall, handleExceptionThrown, handleLogEntryAdded } from './console.js';
import { enableWebSocketCapture, getWebSocketFrames, handleWebSocketCreated, handleWebSocketFrameSent, handleWebSocketFrameReceived, handleWebSocketClosed } from './websocket.js';
import { getPerformanceMetrics, evaluateInPage, setRequestInterception } from './performance.js';

// Re-export all functions
export {
  attachDebugger,
  detachDebugger,
  getDebuggerStatus,
  enableNetworkCapture,
  getNetworkLogs,
  enableConsoleCapture,
  getConsoleLogs,
  enableWebSocketCapture,
  getWebSocketFrames,
  getPerformanceMetrics,
  evaluateInPage,
  setRequestInterception
};

/**
 * Limpa logs
 */
export function clearLogs(sessionId, type = 'all') {
  const state = getDebuggerState(sessionId);
  if (!state) return { success: false, message: 'Session not found' };

  if (type === 'all' || type === 'network') {
    state.networkLogs = [];
    state.pendingRequests.clear();
  }
  if (type === 'all' || type === 'console') {
    state.consoleLogs = [];
  }
  if (type === 'all' || type === 'websocket') {
    state.wsFrames = [];
  }

  return { success: true, message: `Cleared ${type} logs` };
}

/**
 * Handler para eventos do Debugger
 */
export function handleDebuggerEvent(source, method, params) {
  // Encontra a sessão pelo tabId
  let sessionId = null;
  for (const [sid, session] of automationSessions.entries()) {
    const tabId = session.activeTabId || session.tabId;
    if (tabId === source.tabId) {
      sessionId = sid;
      break;
    }
  }

  if (!sessionId) return;

  const state = getDebuggerState(sessionId);
  if (!state) return;

  // Network events
  if (method === 'Network.requestWillBeSent') {
    handleNetworkRequest(state, params);
  }
  if (method === 'Network.responseReceived') {
    handleNetworkResponse(state, params);
  }
  if (method === 'Network.loadingFinished') {
    handleLoadingFinished(state, params);
  }
  if (method === 'Network.loadingFailed') {
    handleLoadingFailed(state, params);
  }

  // WebSocket events
  if (method === 'Network.webSocketCreated') {
    handleWebSocketCreated(state, params);
  }
  if (method === 'Network.webSocketFrameSent') {
    handleWebSocketFrameSent(state, params);
  }
  if (method === 'Network.webSocketFrameReceived') {
    handleWebSocketFrameReceived(state, params);
  }
  if (method === 'Network.webSocketClosed') {
    handleWebSocketClosed(state, params);
  }

  // Console events
  if (method === 'Runtime.consoleAPICalled') {
    handleConsoleAPICall(state, params);
  }
  if (method === 'Runtime.exceptionThrown') {
    handleExceptionThrown(state, params);
  }
  if (method === 'Log.entryAdded') {
    handleLogEntryAdded(state, params);
  }
}

/**
 * Handler para quando debugger é desanexado
 */
export function handleDebuggerDetach(source, reason) {
  for (const [sessionId, session] of automationSessions.entries()) {
    const tabId = session.activeTabId || session.tabId;
    if (tabId === source.tabId) {
      const state = getDebuggerState(sessionId);
      if (state) {
        state.attached = false;
        state.networkEnabled = false;
        state.consoleEnabled = false;
        state.wsEnabled = false;
      }
      console.log(`[Universal MCP] Debugger detached from session ${sessionId}: ${reason}`);
      break;
    }
  }
}

/**
 * Inicializa listeners do debugger
 */
export function initDebuggerListeners() {
  chrome.debugger.onEvent.addListener(handleDebuggerEvent);
  chrome.debugger.onDetach.addListener(handleDebuggerDetach);
}
