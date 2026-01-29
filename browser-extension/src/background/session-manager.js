/**
 * Gerenciamento de sessões de automação com suporte a múltiplas abas (handles)
 */

import { automationSessions, windowToSession, debuggerState } from './state.js';

/**
 * Limpa o debugger de uma tab
 */
async function cleanupDebuggerForTab(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    console.log(`[Universal MCP] Detached debugger from tab ${tabId}`);
  } catch (e) {
    // Ignora erro se debugger não estava anexado
  }
}

/**
 * Cria uma nova sessão de automação com janela dedicada
 */
export async function createAutomationSession(sessionId, url = 'about:blank') {
  // Verifica se já existe sessão com esse ID
  if (automationSessions.has(sessionId)) {
    const existing = automationSessions.get(sessionId);

    try {
      await chrome.windows.get(existing.windowId);
      await chrome.windows.update(existing.windowId, { focused: true });

      console.log(`[Universal MCP] Reusing existing session: ${sessionId}`);

      return {
        success: true,
        sessionId,
        windowId: existing.windowId,
        activeTabId: existing.activeTabId,
        tabCount: existing.tabs.size,
        message: 'Session already exists, reusing'
      };
    } catch (e) {
      automationSessions.delete(sessionId);
      windowToSession.delete(existing.windowId);
      debuggerState.delete(sessionId);
    }
  }

  // Cria nova janela
  console.log(`[Universal MCP] Creating new automation session...`);

  const window = await chrome.windows.create({
    url: url || 'about:blank',
    type: 'normal',
    width: 1280,
    height: 900,
    focused: true
  });

  const tabId = window.tabs[0].id;
  const windowId = window.id;

  // Estrutura com suporte a múltiplas abas
  const tabs = new Map();
  tabs.set(tabId, { url: url || 'about:blank', title: '', createdAt: Date.now() });

  automationSessions.set(sessionId, {
    windowId,
    tabs,
    activeTabId: tabId,
    createdAt: Date.now()
  });

  windowToSession.set(windowId, sessionId);

  console.log(`[Universal MCP] Created session: ${sessionId} (window: ${windowId}, tab: ${tabId})`);

  return {
    success: true,
    sessionId,
    windowId,
    activeTabId: tabId,
    tabCount: 1,
    message: 'Automation session created'
  };
}

/**
 * Abre uma nova aba na sessão
 */
export async function openNewTab(sessionId, url = 'about:blank', switchTo = true) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const tab = await chrome.tabs.create({
    windowId: session.windowId,
    url: url || 'about:blank',
    active: switchTo
  });

  session.tabs.set(tab.id, { url: url || 'about:blank', title: '', createdAt: Date.now() });

  if (switchTo) {
    session.activeTabId = tab.id;
  }

  console.log(`[Universal MCP] Opened new tab ${tab.id} in session ${sessionId}`);

  return {
    success: true,
    tabId: tab.id,
    tabCount: session.tabs.size,
    isActive: switchTo
  };
}

/**
 * Retorna todas as abas (handles) da sessão
 */
export async function getTabHandles(sessionId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const handles = [];

  for (const [tabId, data] of session.tabs.entries()) {
    try {
      const tab = await chrome.tabs.get(tabId);
      handles.push({
        tabId,
        url: tab.url,
        title: tab.title,
        isActive: tabId === session.activeTabId,
        createdAt: data.createdAt
      });
    } catch (e) {
      // Tab foi fechada, remove do registro
      session.tabs.delete(tabId);
    }
  }

  return {
    success: true,
    activeTabId: session.activeTabId,
    tabCount: handles.length,
    handles
  };
}

/**
 * Muda para uma aba específica
 */
export async function switchToTab(sessionId, tabId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (!session.tabs.has(tabId)) {
    return { success: false, error: `Tab ${tabId} not found in session` };
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
    session.activeTabId = tabId;

    const tab = await chrome.tabs.get(tabId);

    console.log(`[Universal MCP] Switched to tab ${tabId} in session ${sessionId}`);

    return {
      success: true,
      tabId,
      url: tab.url,
      title: tab.title
    };
  } catch (e) {
    session.tabs.delete(tabId);
    return { success: false, error: `Tab ${tabId} no longer exists` };
  }
}

/**
 * Fecha uma aba específica
 */
export async function closeTab(sessionId, tabId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (!session.tabs.has(tabId)) {
    return { success: false, error: `Tab ${tabId} not found in session` };
  }

  // Não permite fechar a última aba
  if (session.tabs.size === 1) {
    return { success: false, error: 'Cannot close the last tab. Use close_automation_session instead.' };
  }

  try {
    await cleanupDebuggerForTab(tabId);
    await chrome.tabs.remove(tabId);
    session.tabs.delete(tabId);

    // Se fechou a aba ativa, muda para outra
    if (session.activeTabId === tabId) {
      const nextTabId = session.tabs.keys().next().value;
      session.activeTabId = nextTabId;
      await chrome.tabs.update(nextTabId, { active: true });
    }

    console.log(`[Universal MCP] Closed tab ${tabId} in session ${sessionId}`);

    return {
      success: true,
      closedTabId: tabId,
      newActiveTabId: session.activeTabId,
      tabCount: session.tabs.size
    };
  } catch (e) {
    session.tabs.delete(tabId);
    return { success: false, error: e.message };
  }
}

/**
 * Retorna a aba ativa atual
 */
export function getCurrentTab(sessionId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  return {
    success: true,
    tabId: session.activeTabId,
    tabCount: session.tabs.size
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

  // Limpa debugger de todas as abas
  for (const tabId of session.tabs.keys()) {
    await cleanupDebuggerForTab(tabId);
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
 * Captura screenshot da aba ativa
 */
export async function takeScreenshotOfSession(sessionId, format = 'jpeg', quality = 50) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    throw new Error('No automation session found');
  }

  try {
    const captureOptions = { format: format };
    if (format === 'jpeg') {
      captureOptions.quality = Math.max(1, Math.min(100, quality));
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(session.windowId, captureOptions);
    return {
      success: true,
      dataUrl,
      tabId: session.activeTabId,
      format: format,
      quality: format === 'jpeg' ? captureOptions.quality : null,
      timestamp: Date.now()
    };
  } catch (error) {
    throw new Error(`Failed to capture screenshot: ${error.message}`);
  }
}

/**
 * Navega para uma URL na aba ativa
 */
export async function navigateInSession(sessionId, url) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  await chrome.tabs.update(session.activeTabId, { url });

  return { success: true, tabId: session.activeTabId, url };
}

/**
 * Retorna informações de uma sessão
 */
export function getSessionInfo(sessionId) {
  const session = automationSessions.get(sessionId);
  if (!session) return null;

  return {
    windowId: session.windowId,
    tabId: session.activeTabId, // Para compatibilidade
    activeTabId: session.activeTabId,
    tabCount: session.tabs.size,
    createdAt: session.createdAt
  };
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
      activeTabId: data.activeTabId,
      tabCount: data.tabs.size,
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

  // Monitora fechamento de abas
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    const sessionId = windowToSession.get(removeInfo.windowId);
    if (sessionId) {
      const session = automationSessions.get(sessionId);
      if (session && session.tabs.has(tabId)) {
        session.tabs.delete(tabId);
        console.log(`[Universal MCP] Tab ${tabId} removed from session ${sessionId}`);

        // Se era a aba ativa, muda para outra
        if (session.activeTabId === tabId && session.tabs.size > 0) {
          session.activeTabId = session.tabs.keys().next().value;
        }
      }
    }
  });

  // Monitora navegação
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId === 0) {
      const sessionId = windowToSession.get(details.windowId);
      if (sessionId) {
        const session = automationSessions.get(sessionId);
        if (session && session.tabs.has(details.tabId)) {
          session.tabs.get(details.tabId).url = details.url;
        }
      }
    }
  });

  // Monitora mudanças de aba ativa
  chrome.tabs.onActivated.addListener((activeInfo) => {
    const sessionId = windowToSession.get(activeInfo.windowId);
    if (sessionId) {
      const session = automationSessions.get(sessionId);
      if (session && session.tabs.has(activeInfo.tabId)) {
        session.activeTabId = activeInfo.tabId;
        console.log(`[Universal MCP] Active tab changed to ${activeInfo.tabId} in session ${sessionId}`);
      }
    }
  });

  // Monitora criação de abas (ex: target="_blank")
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.windowId) {
      const sessionId = windowToSession.get(tab.windowId);
      if (sessionId) {
        const session = automationSessions.get(sessionId);
        if (session && !session.tabs.has(tab.id)) {
          session.tabs.set(tab.id, { url: tab.url || 'about:blank', title: '', createdAt: Date.now() });
          console.log(`[Universal MCP] New tab ${tab.id} detected in session ${sessionId}`);
        }
      }
    }
  });
}
