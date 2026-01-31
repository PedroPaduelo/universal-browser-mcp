/**
 * Core debugger functions - attach/detach
 */

import { automationSessions } from '../state.js';
import { initDebuggerState, getDebuggerState } from './state.js';

/**
 * Anexa o debugger a uma tab de automação
 */
export async function attachDebugger(sessionId) {
  const session = automationSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const tabId = session.activeTabId || session.tabId;
  if (!tabId) {
    throw new Error(`No active tab in session: ${sessionId}`);
  }

  const state = initDebuggerState(sessionId);

  if (state.attached) {
    return { success: true, message: 'Debugger already attached' };
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    state.attached = true;

    console.log(`[Universal MCP] Debugger attached to session ${sessionId}`);

    return {
      success: true,
      message: 'Debugger attached',
      tabId
    };
  } catch (error) {
    // Se o erro é que outro debugger já está anexado, tenta desanexar e reanexar
    if (error.message && error.message.includes('Another debugger is already attached')) {
      console.log(`[Universal MCP] Debugger already attached to tab ${tabId}, attempting to detach and reattach...`);

      try {
        // Tenta desanexar o debugger existente
        await chrome.debugger.detach({ tabId });
        console.log(`[Universal MCP] Previous debugger detached from tab ${tabId}`);

        // Aguarda um pouco para o Chrome processar
        await new Promise(resolve => setTimeout(resolve, 100));

        // Tenta anexar novamente
        await chrome.debugger.attach({ tabId }, '1.3');
        state.attached = true;

        console.log(`[Universal MCP] Debugger reattached to session ${sessionId}`);

        return {
          success: true,
          message: 'Debugger reattached (previous debugger was detached)',
          tabId
        };
      } catch (retryError) {
        // Se ainda falhar, marca como anexado e tenta usar mesmo assim
        // (pode ser que seja o mesmo debugger da extensão)
        console.log(`[Universal MCP] Could not reattach debugger, assuming already attached by this extension`);
        state.attached = true;

        return {
          success: true,
          message: 'Assuming debugger is already attached by this extension',
          tabId
        };
      }
    }

    throw new Error(`Failed to attach debugger: ${error.message}`);
  }
}

/**
 * Desanexa o debugger
 */
export async function detachDebugger(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = getDebuggerState(sessionId);

  if (!session || !state || !state.attached) {
    return { success: true, message: 'Debugger not attached' };
  }

  const tabId = session.activeTabId || session.tabId;

  try {
    await chrome.debugger.detach({ tabId });
    state.attached = false;
    state.networkEnabled = false;
    state.consoleEnabled = false;
    state.wsEnabled = false;

    console.log(`[Universal MCP] Debugger detached from session ${sessionId}`);

    return { success: true, message: 'Debugger detached' };
  } catch (error) {
    state.attached = false;
    return { success: true, message: 'Debugger detached (was already detached)' };
  }
}

/**
 * Retorna status do debugger
 */
export function getDebuggerStatus(sessionId) {
  const state = getDebuggerState(sessionId);
  return {
    attached: state?.attached || false,
    networkEnabled: state?.networkEnabled || false,
    consoleEnabled: state?.consoleEnabled || false,
    wsEnabled: state?.wsEnabled || false,
    networkLogsCount: state?.networkLogs?.length || 0,
    consoleLogsCount: state?.consoleLogs?.length || 0,
    wsFramesCount: state?.wsFrames?.length || 0
  };
}
