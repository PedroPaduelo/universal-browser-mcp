/**
 * Gerenciamento de sessões de automação
 */

import { automationSessions, windowToSession, debuggerState } from './state.js';

/**
 * Limpa o debugger de uma tab antes de reutilizar
 */
async function cleanupDebuggerForTab(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    console.log(`[Universal MCP] Detached debugger from tab ${tabId} during cleanup`);
  } catch (e) {
    // Ignora erro se debugger não estava anexado
  }
}

/**
 * Cria uma nova sessão de automação com janela dedicada
 * Reutiliza janela existente se houver para evitar múltiplas janelas
 */
export async function createAutomationSession(sessionId, url = 'about:blank') {
  // Verifica se já existe sessão com esse ID específico
  if (automationSessions.has(sessionId)) {
    const existing = automationSessions.get(sessionId);

    try {
      await chrome.windows.get(existing.windowId);

      // Limpa o debugger antes de reutilizar para evitar conflitos
      await cleanupDebuggerForTab(existing.tabId);
      debuggerState.delete(sessionId);

      if (url && url !== 'about:blank') {
        await chrome.tabs.update(existing.tabId, { url });
      }

      await chrome.windows.update(existing.windowId, { focused: true });

      console.log(`[Universal MCP] Reusing existing session: ${sessionId}`);

      return {
        success: true,
        sessionId,
        windowId: existing.windowId,
        tabId: existing.tabId,
        message: 'Session already exists, reusing'
      };
    } catch (e) {
      automationSessions.delete(sessionId);
      windowToSession.delete(existing.windowId);
      debuggerState.delete(sessionId);
    }
  }

  // Verifica se existe QUALQUER outra sessão de automação ativa
  if (automationSessions.size > 0) {
    for (const [existingSessionId, existingData] of automationSessions.entries()) {
      try {
        await chrome.windows.get(existingData.windowId);

        console.log(`[Universal MCP] Found existing automation window from session ${existingSessionId}, reusing...`);

        // IMPORTANTE: Limpa o debugger antes de transferir a sessão
        await cleanupDebuggerForTab(existingData.tabId);
        debuggerState.delete(existingSessionId);

        if (url && url !== 'about:blank') {
          await chrome.tabs.update(existingData.tabId, { url });
        }

        await chrome.windows.update(existingData.windowId, { focused: true });

        automationSessions.delete(existingSessionId);
        automationSessions.set(sessionId, {
          windowId: existingData.windowId,
          tabId: existingData.tabId,
          createdAt: existingData.createdAt
        });
        windowToSession.set(existingData.windowId, sessionId);

        console.log(`[Universal MCP] Transferred window from ${existingSessionId} to ${sessionId}`);

        return {
          success: true,
          sessionId,
          windowId: existingData.windowId,
          tabId: existingData.tabId,
          message: 'Reused existing automation window (transferred from previous session)'
        };
      } catch (e) {
        automationSessions.delete(existingSessionId);
        windowToSession.delete(existingData.windowId);
        debuggerState.delete(existingSessionId);
      }
    }
  }

  // Cria nova janela
  console.log(`[Universal MCP] No existing automation window found, creating new one...`);

  const window = await chrome.windows.create({
    url: url || 'about:blank',
    type: 'normal',
    width: 1280,
    height: 900,
    focused: true
  });

  const tabId = window.tabs[0].id;
  const windowId = window.id;

  automationSessions.set(sessionId, {
    windowId,
    tabId,
    createdAt: Date.now()
  });

  windowToSession.set(windowId, sessionId);

  console.log(`[Universal MCP] Created automation session: ${sessionId} (window: ${windowId}, tab: ${tabId})`);

  return {
    success: true,
    sessionId,
    windowId,
    tabId,
    message: 'Automation session created'
  };
}

/**
 * Fecha uma sessão de automação
 */
export async function closeAutomationSession(sessionId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  try {
    await chrome.windows.remove(session.windowId);
  } catch (e) {
    // Janela já foi fechada manualmente
  }

  automationSessions.delete(sessionId);
  windowToSession.delete(session.windowId);
  debuggerState.delete(sessionId);

  console.log(`[Universal MCP] Closed automation session: ${sessionId}`);

  return { success: true, message: 'Session closed' };
}

/**
 * Captura screenshot de uma sessão de automação
 * @param {string} sessionId - ID da sessão (opcional)
 * @param {string} format - 'jpeg' ou 'png' (padrão: 'jpeg')
 * @param {number} quality - Qualidade JPEG 1-100 (padrão: 50)
 */
export async function takeScreenshotOfSession(sessionId, format = 'jpeg', quality = 50) {
  let targetSession = null;

  if (sessionId) {
    targetSession = automationSessions.get(sessionId);
  } else if (automationSessions.size > 0) {
    const [, firstSession] = automationSessions.entries().next().value;
    targetSession = firstSession;
  }

  if (!targetSession) {
    throw new Error('No automation session found for screenshot');
  }

  try {
    // Configura opções do screenshot
    const captureOptions = { format: format };
    if (format === 'jpeg') {
      captureOptions.quality = Math.max(1, Math.min(100, quality));
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(targetSession.windowId, captureOptions);
    return {
      success: true,
      dataUrl,
      windowId: targetSession.windowId,
      format: format,
      quality: format === 'jpeg' ? captureOptions.quality : null,
      timestamp: Date.now()
    };
  } catch (error) {
    throw new Error(`Failed to capture screenshot: ${error.message}`);
  }
}

/**
 * Navega para uma URL dentro de uma sessão específica
 */
export async function navigateInSession(sessionId, url) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  await chrome.tabs.update(session.tabId, { url });

  return { success: true, url };
}

/**
 * Retorna informações de uma sessão
 */
export function getSessionInfo(sessionId) {
  return automationSessions.get(sessionId);
}

/**
 * Lista todas as sessões ativas
 */
export function listSessions() {
  const sessions = [];
  for (const [sessionId, data] of automationSessions.entries()) {
    sessions.push({
      sessionId,
      windowId: data.windowId,
      tabId: data.tabId,
      createdAt: data.createdAt
    });
  }
  return sessions;
}

/**
 * Inicializa listeners de janela/tab
 */
export function initSessionListeners() {
  // Monitora fechamento de janelas
  chrome.windows.onRemoved.addListener((windowId) => {
    const sessionId = windowToSession.get(windowId);
    if (sessionId) {
      console.log(`[Universal MCP] Window closed, removing session: ${sessionId}`);
      automationSessions.delete(sessionId);
      windowToSession.delete(windowId);
      debuggerState.delete(sessionId);
    }
  });

  // Monitora navegação
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId === 0) {
      const sessionId = windowToSession.get(details.windowId);
      if (sessionId) {
        console.log(`[Universal MCP] Navigation completed in session ${sessionId}:`, details.url);
      }
    }
  });

  // Monitora mudanças de tab
  chrome.tabs.onActivated.addListener((activeInfo) => {
    const sessionId = windowToSession.get(activeInfo.windowId);
    if (sessionId) {
      const session = automationSessions.get(sessionId);
      if (session && session.tabId !== activeInfo.tabId) {
        console.log(`[Universal MCP] Tab changed in session ${sessionId}: ${session.tabId} -> ${activeInfo.tabId}`);
        session.tabId = activeInfo.tabId;
      }
    }
  });
}
