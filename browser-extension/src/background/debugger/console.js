/**
 * Console capture functionality
 */

import { automationSessions } from '../state.js';
import { initDebuggerState, getDebuggerState } from './state.js';
import { attachDebugger } from './core.js';

/**
 * Habilita captura de Console
 */
export async function enableConsoleCapture(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  const tabId = session.activeTabId || session.tabId;
  if (!tabId) throw new Error('No active tab in session');

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable', {});
    await chrome.debugger.sendCommand({ tabId }, 'Log.enable', {});

    state.consoleEnabled = true;
    state.consoleLogs = [];

    console.log(`[Universal MCP] Console capture enabled for session ${sessionId}`);

    return { success: true, message: 'Console capture enabled' };
  } catch (error) {
    throw new Error(`Failed to enable Console: ${error.message}`);
  }
}

/**
 * Retorna logs do Console
 */
export function getConsoleLogs(sessionId, options = {}) {
  const state = getDebuggerState(sessionId);
  if (!state) {
    return { logs: [], total: 0, hasMore: false };
  }

  let logs = state.consoleLogs;

  if (options.level) {
    logs = logs.filter(l => l.level === options.level);
  }
  if (options.textFilter) {
    logs = logs.filter(l => l.text?.includes(options.textFilter));
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
 * Processa console API call
 */
export function handleConsoleAPICall(state, params) {
  const log = {
    type: 'console',
    level: params.type,
    timestamp: params.timestamp || Date.now(),
    args: params.args?.map(arg => {
      if (arg.type === 'string') return arg.value;
      if (arg.type === 'number') return arg.value;
      if (arg.type === 'boolean') return arg.value;
      if (arg.type === 'undefined') return undefined;
      if (arg.type === 'object' && arg.preview) {
        return arg.preview.description || JSON.stringify(arg.preview.properties?.slice(0, 10));
      }
      return `[${arg.type}]`;
    }),
    text: params.args?.map(arg => arg.value || arg.description || `[${arg.type}]`).join(' '),
    stackTrace: params.stackTrace?.callFrames?.slice(0, 5)
  };

  if (state.consoleLogs.length >= state.maxLogs) state.consoleLogs.shift();
  state.consoleLogs.push(log);
}

/**
 * Processa exception thrown
 */
export function handleExceptionThrown(state, params) {
  const log = {
    type: 'exception',
    level: 'error',
    timestamp: params.timestamp || Date.now(),
    text: params.exceptionDetails?.text || 'Exception',
    description: params.exceptionDetails?.exception?.description,
    stackTrace: params.exceptionDetails?.stackTrace?.callFrames?.slice(0, 5),
    lineNumber: params.exceptionDetails?.lineNumber,
    columnNumber: params.exceptionDetails?.columnNumber,
    url: params.exceptionDetails?.url
  };

  if (state.consoleLogs.length >= state.maxLogs) state.consoleLogs.shift();
  state.consoleLogs.push(log);
}

/**
 * Processa log entry added
 */
export function handleLogEntryAdded(state, params) {
  const log = {
    type: 'browser',
    level: params.entry.level,
    timestamp: params.entry.timestamp || Date.now(),
    text: params.entry.text,
    source: params.entry.source,
    url: params.entry.url,
    lineNumber: params.entry.lineNumber
  };

  if (state.consoleLogs.length >= state.maxLogs) state.consoleLogs.shift();
  state.consoleLogs.push(log);
}
