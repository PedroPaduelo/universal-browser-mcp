/**
 * Network capture functionality
 */

import { automationSessions } from '../state.js';
import { initDebuggerState, getDebuggerState } from './state.js';
import { attachDebugger } from './core.js';

/**
 * Habilita captura de Network
 */
export async function enableNetworkCapture(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  const tabId = session.activeTabId || session.tabId;
  if (!tabId) throw new Error('No active tab in session');

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
    state.networkEnabled = true;
    state.networkLogs = [];
    state.pendingRequests.clear();

    console.log(`[Universal MCP] Network capture enabled for session ${sessionId}`);

    return { success: true, message: 'Network capture enabled' };
  } catch (error) {
    throw new Error(`Failed to enable Network: ${error.message}`);
  }
}

/**
 * Retorna logs de Network
 */
export function getNetworkLogs(sessionId, options = {}) {
  const state = getDebuggerState(sessionId);
  if (!state) {
    return { logs: [], total: 0, hasMore: false };
  }

  let logs = state.networkLogs;

  // Filtros
  if (options.urlFilter) {
    logs = logs.filter(l => l.url?.includes(options.urlFilter));
  }
  if (options.method) {
    logs = logs.filter(l => l.method === options.method);
  }
  if (options.status) {
    logs = logs.filter(l => l.status === options.status);
  }
  if (options.type) {
    logs = logs.filter(l => l.type === options.type);
  }

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  return {
    logs: logs.slice(offset, offset + limit),
    total: logs.length,
    hasMore: logs.length > offset + limit
  };
}

/**
 * Processa evento de request
 */
export function handleNetworkRequest(state, params) {
  const log = {
    id: params.requestId,
    type: 'request',
    timestamp: Date.now(),
    url: params.request.url,
    method: params.request.method,
    headers: params.request.headers,
    postData: params.request.postData,
    initiator: params.initiator?.type,
    resourceType: params.type
  };

  state.pendingRequests.set(params.requestId, log);

  if (state.networkLogs.length >= state.maxLogs) {
    state.networkLogs.shift();
  }
  state.networkLogs.push(log);
}

/**
 * Processa resposta recebida
 */
export function handleNetworkResponse(state, params) {
  const pending = state.pendingRequests.get(params.requestId);
  if (pending) {
    pending.status = params.response.status;
    pending.statusText = params.response.statusText;
    pending.responseHeaders = params.response.headers;
    pending.mimeType = params.response.mimeType;
    pending.timing = params.response.timing;
  }
}

/**
 * Processa loading finished
 */
export function handleLoadingFinished(state, params) {
  const pending = state.pendingRequests.get(params.requestId);
  if (pending) {
    pending.completed = true;
    pending.encodedDataLength = params.encodedDataLength;
    state.pendingRequests.delete(params.requestId);
  }
}

/**
 * Processa loading failed
 */
export function handleLoadingFailed(state, params) {
  const pending = state.pendingRequests.get(params.requestId);
  if (pending) {
    pending.failed = true;
    pending.errorText = params.errorText;
    state.pendingRequests.delete(params.requestId);
  }
}
