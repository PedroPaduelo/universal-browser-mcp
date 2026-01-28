/**
 * Performance metrics functionality
 */

import { automationSessions } from '../state.js';
import { initDebuggerState } from './state.js';
import { attachDebugger } from './core.js';

/**
 * Obtém métricas de performance
 */
export async function getPerformanceMetrics(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  try {
    await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Performance.enable', {});

    const { metrics } = await chrome.debugger.sendCommand(
      { tabId: session.tabId },
      'Performance.getMetrics',
      {}
    );

    const formattedMetrics = {};
    for (const metric of metrics) {
      formattedMetrics[metric.name] = metric.value;
    }

    return {
      success: true,
      metrics: formattedMetrics,
      timestamp: Date.now()
    };
  } catch (error) {
    throw new Error(`Failed to get performance metrics: ${error.message}`);
  }
}

/**
 * Executa JavaScript no contexto da página via debugger
 */
export async function evaluateInPage(sessionId, expression, options = {}) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: session.tabId },
      'Runtime.evaluate',
      {
        expression,
        returnByValue: options.returnByValue !== false,
        awaitPromise: options.awaitPromise !== false,
        userGesture: options.userGesture || false
      }
    );

    if (result.exceptionDetails) {
      return {
        success: false,
        error: result.exceptionDetails.text || 'Script execution failed',
        exceptionDetails: result.exceptionDetails
      };
    }

    return {
      success: true,
      result: result.result?.value,
      type: result.result?.type
    };
  } catch (error) {
    throw new Error(`Failed to evaluate: ${error.message}`);
  }
}

/**
 * Intercepta requests
 */
export async function setRequestInterception(sessionId, patterns, enabled = true) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  try {
    if (enabled) {
      await chrome.debugger.sendCommand(
        { tabId: session.tabId },
        'Fetch.enable',
        { patterns: patterns || [{ urlPattern: '*' }] }
      );
    } else {
      await chrome.debugger.sendCommand(
        { tabId: session.tabId },
        'Fetch.disable',
        {}
      );
    }

    return { success: true, enabled, patterns };
  } catch (error) {
    throw new Error(`Failed to set request interception: ${error.message}`);
  }
}
