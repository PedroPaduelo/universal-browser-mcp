/**
 * Universal Browser MCP - Background Service Worker
 * Gerencia sessões de automação isoladas por janela dedicada
 * Mantém conexão WebSocket com o servidor MCP para receber comandos
 */

// Armazena sessões ativas: sessionId -> { windowId, tabId, createdAt }
const automationSessions = new Map();

// Mapeia windowId -> sessionId para lookup reverso
const windowToSession = new Map();

// Conexão WebSocket com o servidor MCP
let mcpWebSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 20;
const WS_URL = 'ws://localhost:3002';

// ================================================================================
// KEEP-ALIVE MECHANISM - Previne que o Service Worker durma
// ================================================================================

const KEEP_ALIVE_ALARM = 'keep-alive';
const KEEP_ALIVE_INTERVAL = 0.4; // 24 segundos (menos que 30s limite do Chrome)

// Cria alarm para manter o SW ativo
async function setupKeepAlive() {
  try {
    await chrome.alarms.create(KEEP_ALIVE_ALARM, {
      periodInMinutes: KEEP_ALIVE_INTERVAL
    });
    console.log('[Universal MCP] Keep-alive alarm created');
  } catch (e) {
    console.error('[Universal MCP] Failed to create keep-alive alarm:', e);
  }
}

// Listener do alarm - mantém o SW ativo
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // Ping para manter conexão WebSocket ativa
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
      // Reconecta se desconectado
      connectToMCPServer();
    }
  }
});

// ================================================================================

// Quando a extensão é instalada
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Universal MCP] Extension installed');
  setupKeepAlive();
  connectToMCPServer();
});

// Quando o service worker é ativado
chrome.runtime.onStartup.addListener(() => {
  console.log('[Universal MCP] Extension started');
  setupKeepAlive();
  connectToMCPServer();
});

// Garante keep-alive na inicialização do script
setupKeepAlive();

// Flag para evitar múltiplas tentativas simultâneas
let isConnecting = false;

// Conecta ao servidor MCP via WebSocket
function connectToMCPServer() {
  // Evita múltiplas conexões simultâneas
  if (isConnecting) {
    console.log('[Universal MCP] Connection already in progress...');
    return;
  }

  if (mcpWebSocket && mcpWebSocket.readyState === WebSocket.OPEN) {
    console.log('[Universal MCP] Already connected to MCP server');
    return;
  }

  // Limpa conexão antiga se existir em estado intermediário
  if (mcpWebSocket) {
    try {
      mcpWebSocket.close();
    } catch (e) {}
    mcpWebSocket = null;
  }

  isConnecting = true;
  console.log('[Universal MCP] Connecting to MCP server...');

  try {
    mcpWebSocket = new WebSocket(WS_URL);

    mcpWebSocket.onopen = () => {
      console.log('[Universal MCP] Connected to MCP server!');
      isConnecting = false;
      reconnectAttempts = 0;

      // Envia identificação como background controller
      mcpWebSocket.send(JSON.stringify({
        type: 'background_ready',
        sessionId: '__background__',
        data: {
          extensionId: chrome.runtime.id,
          timestamp: Date.now()
        }
      }));
    };

    mcpWebSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMCPMessage(message);
      } catch (error) {
        console.error('[Universal MCP] Error parsing MCP message:', error);
      }
    };

    mcpWebSocket.onclose = (event) => {
      console.log(`[Universal MCP] Disconnected from MCP server (code: ${event.code})`);
      isConnecting = false;
      mcpWebSocket = null;

      // Só agenda reconexão se não foi fechamento intencional
      if (event.code !== 1000) {
        scheduleReconnect();
      }
    };

    mcpWebSocket.onerror = (error) => {
      console.error('[Universal MCP] WebSocket error:', error);
      isConnecting = false;
    };

  } catch (error) {
    console.error('[Universal MCP] Failed to connect:', error);
    isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.log('[Universal MCP] Max reconnect attempts reached, will retry on next event');
    reconnectAttempts = 0;
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
  console.log(`[Universal MCP] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  setTimeout(connectToMCPServer, delay);
}

// Processa mensagens do servidor MCP
async function handleMCPMessage(message) {
  const { type, requestId, sessionId, mcpInstanceId, data } = message;

  console.log('[Universal MCP] Received from MCP:', type, sessionId, mcpInstanceId ? `(from: ${mcpInstanceId})` : '');

  // Ignora mensagens que não são para o background
  if (sessionId && sessionId !== '__background__' && !sessionId.startsWith('session_')) {
    return;
  }

  let result = null;
  let success = true;
  let error = null;

  try {
    switch (type) {
      case 'create_session_command':
        // Comando do MCP para criar uma nova sessão
        result = await createAutomationSession(data.sessionId, data.url);
        break;

      case 'close_session_command':
        result = await closeAutomationSession(data.sessionId);
        break;

      case 'get_sessions_command':
        const sessions = [];
        for (const [sid, sdata] of automationSessions.entries()) {
          sessions.push({
            sessionId: sid,
            windowId: sdata.windowId,
            tabId: sdata.tabId,
            createdAt: sdata.createdAt
          });
        }
        result = { sessions };
        break;

      case 'ping':
        result = { pong: true, timestamp: Date.now() };
        break;

      case 'take_screenshot_command':
        // Captura screenshot da janela de automação
        result = await takeScreenshotOfSession(data?.sessionId, data?.format, data?.quality);
        break;

      default:
        // Ignora mensagens desconhecidas (podem ser para content-scripts)
        return;
    }
  } catch (e) {
    success = false;
    error = e.message;
    console.error('[Universal MCP] Error handling MCP message:', e);
  }

  // Envia resposta se houver requestId
  // IMPORTANTE: Inclui mcpInstanceId para rotear a resposta de volta ao cliente correto
  if (requestId && mcpWebSocket && mcpWebSocket.readyState === WebSocket.OPEN) {
    mcpWebSocket.send(JSON.stringify({
      type: 'response',
      requestId,
      sessionId: '__background__',
      mcpInstanceId, // Inclui o ID da instância MCP que fez a requisição
      success,
      data: result,
      error
    }));
  }
}

// Tenta conectar imediatamente na inicialização
connectToMCPServer();

// Listener para mensagens do popup, content scripts ou MCP server
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Universal MCP] Background received:', message.type);

  switch (message.type) {
    case 'get_status':
      sendResponse({
        status: 'ok',
        activeSessions: automationSessions.size,
        sessions: Array.from(automationSessions.entries()).map(([id, data]) => ({
          sessionId: id,
          windowId: data.windowId,
          tabId: data.tabId
        }))
      });
      break;

    case 'create_automation_session':
      createAutomationSession(message.sessionId, message.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'close_automation_session':
      closeAutomationSession(message.sessionId)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'get_session_info':
      const session = automationSessions.get(message.sessionId);
      if (session) {
        chrome.tabs.get(session.tabId, (tab) => {
          sendResponse({
            success: true,
            session: {
              sessionId: message.sessionId,
              windowId: session.windowId,
              tabId: session.tabId,
              url: tab?.url || null,
              title: tab?.title || null
            }
          });
        });
      } else {
        sendResponse({ success: false, error: 'Session not found' });
      }
      return true;

    case 'is_automation_tab':
      // Verifica se a tab atual pertence a uma sessão de automação
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;

      if (windowId && windowToSession.has(windowId)) {
        const sessionId = windowToSession.get(windowId);
        const sessionData = automationSessions.get(sessionId);

        if (sessionData && sessionData.tabId === tabId) {
          sendResponse({
            isAutomationTab: true,
            sessionId: sessionId
          });
        } else {
          sendResponse({ isAutomationTab: false });
        }
      } else {
        sendResponse({ isAutomationTab: false });
      }
      break;

    case 'get_active_tab':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse({ tab: tabs[0] || null });
      });
      return true;

    case 'list_tabs':
      chrome.tabs.query({}, (tabs) => {
        sendResponse({
          tabs: tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: t.active,
            windowId: t.windowId,
            isAutomation: windowToSession.has(t.windowId)
          }))
        });
      });
      return true;

    case 'list_automation_sessions':
      const sessions = [];
      for (const [sessionId, data] of automationSessions.entries()) {
        sessions.push({
          sessionId,
          windowId: data.windowId,
          tabId: data.tabId,
          createdAt: data.createdAt
        });
      }
      sendResponse({ sessions });
      break;

    case 'take_screenshot':
      const screenshotSession = automationSessions.get(message.sessionId);
      const screenshotFormat = message.format || 'jpeg';
      const screenshotOptions = { format: screenshotFormat };
      if (screenshotFormat === 'jpeg') {
        screenshotOptions.quality = Math.max(1, Math.min(100, message.quality || 50));
      }
      if (screenshotSession) {
        chrome.tabs.captureVisibleTab(screenshotSession.windowId, screenshotOptions, (dataUrl) => {
          sendResponse({ success: true, dataUrl });
        });
      } else {
        // Fallback: screenshot da janela atual
        chrome.tabs.captureVisibleTab(null, screenshotOptions, (dataUrl) => {
          sendResponse({ success: true, dataUrl });
        });
      }
      return true;

    case 'navigate_in_session':
      navigateInSession(message.sessionId, message.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

/**
 * Cria uma nova sessão de automação com janela dedicada
 * IMPORTANTE: Reutiliza janela existente se houver para evitar múltiplas janelas
 */
async function createAutomationSession(sessionId, url = 'about:blank') {
  // Verifica se já existe sessão com esse ID específico
  if (automationSessions.has(sessionId)) {
    const existing = automationSessions.get(sessionId);

    try {
      await chrome.windows.get(existing.windowId);

      // Janela existe, navega para a URL se fornecida
      if (url && url !== 'about:blank') {
        await chrome.tabs.update(existing.tabId, { url });
      }

      // Foca na janela
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
      // Janela não existe mais, remove a sessão antiga
      automationSessions.delete(sessionId);
      windowToSession.delete(existing.windowId);
    }
  }

  // NOVO: Verifica se existe QUALQUER outra sessão de automação ativa
  // e reutiliza a janela existente para evitar múltiplas janelas
  if (automationSessions.size > 0) {
    for (const [existingSessionId, existingData] of automationSessions.entries()) {
      try {
        await chrome.windows.get(existingData.windowId);

        // Janela existe! Reutiliza ela
        console.log(`[Universal MCP] Found existing automation window from session ${existingSessionId}, reusing...`);

        // Navega para a nova URL se fornecida
        if (url && url !== 'about:blank') {
          await chrome.tabs.update(existingData.tabId, { url });
        }

        // Foca na janela
        await chrome.windows.update(existingData.windowId, { focused: true });

        // Atualiza os mapeamentos para a nova sessão
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
        // Janela não existe mais, remove a sessão antiga
        automationSessions.delete(existingSessionId);
        windowToSession.delete(existingData.windowId);
      }
    }
  }

  // Se chegou aqui, não existe nenhuma janela de automação - cria nova
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

  // Registra a sessão
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
async function closeAutomationSession(sessionId) {
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

  console.log(`[Universal MCP] Closed automation session: ${sessionId}`);

  return { success: true, message: 'Session closed' };
}

/**
 * Captura screenshot de uma sessão de automação
 * @param {string} sessionId - ID da sessão (opcional)
 * @param {string} format - 'jpeg' ou 'png' (padrão: 'jpeg')
 * @param {number} quality - Qualidade JPEG 1-100 (padrão: 50)
 */
async function takeScreenshotOfSession(sessionId, format = 'jpeg', quality = 50) {
  // Se não informou sessionId, usa a primeira sessão ativa
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
async function navigateInSession(sessionId, url) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  await chrome.tabs.update(session.tabId, { url });

  return { success: true, url };
}

// Monitora fechamento de janelas para limpar sessões
chrome.windows.onRemoved.addListener((windowId) => {
  const sessionId = windowToSession.get(windowId);

  if (sessionId) {
    console.log(`[Universal MCP] Window closed, removing session: ${sessionId}`);
    automationSessions.delete(sessionId);
    windowToSession.delete(windowId);
  }
});

// Monitora navegação para informar o MCP server
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    const sessionId = windowToSession.get(details.windowId);
    if (sessionId) {
      console.log(`[Universal MCP] Navigation completed in session ${sessionId}:`, details.url);
    }
  }
});

// Monitora mudanças de tab dentro de janelas de automação
chrome.tabs.onActivated.addListener((activeInfo) => {
  const sessionId = windowToSession.get(activeInfo.windowId);
  if (sessionId) {
    const session = automationSessions.get(sessionId);
    // Atualiza o tabId se mudou (usuário abriu nova aba na janela de automação)
    if (session && session.tabId !== activeInfo.tabId) {
      console.log(`[Universal MCP] Tab changed in session ${sessionId}: ${session.tabId} -> ${activeInfo.tabId}`);
      session.tabId = activeInfo.tabId;
    }
  }
});

// ================================================================================
// ADVANCED DEBUGGING - DevTools Protocol Integration
// ================================================================================

// Estado do debugger por sessão
const debuggerState = new Map(); // sessionId -> { attached, networkLogs, consoleLogs, wsFrames, enabled }

/**
 * Inicializa o estado do debugger para uma sessão
 */
function initDebuggerState(sessionId) {
  if (!debuggerState.has(sessionId)) {
    debuggerState.set(sessionId, {
      attached: false,
      networkEnabled: false,
      consoleEnabled: false,
      wsEnabled: false,
      networkLogs: [],
      consoleLogs: [],
      wsFrames: [],
      pendingRequests: new Map(), // requestId -> request data
      maxLogs: 1000 // Limite para evitar memory leak
    });
  }
  return debuggerState.get(sessionId);
}

/**
 * Anexa o debugger a uma tab de automação
 */
async function attachDebugger(sessionId) {
  const session = automationSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const state = initDebuggerState(sessionId);

  if (state.attached) {
    return { success: true, message: 'Debugger already attached' };
  }

  try {
    await chrome.debugger.attach({ tabId: session.tabId }, '1.3');
    state.attached = true;

    console.log(`[Universal MCP] Debugger attached to session ${sessionId}`);

    return {
      success: true,
      message: 'Debugger attached',
      tabId: session.tabId
    };
  } catch (error) {
    throw new Error(`Failed to attach debugger: ${error.message}`);
  }
}

/**
 * Desanexa o debugger
 */
async function detachDebugger(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = debuggerState.get(sessionId);

  if (!session || !state || !state.attached) {
    return { success: true, message: 'Debugger not attached' };
  }

  try {
    await chrome.debugger.detach({ tabId: session.tabId });
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
 * Habilita captura de Network
 */
async function enableNetworkCapture(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  try {
    await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Network.enable', {});
    state.networkEnabled = true;
    state.networkLogs = []; // Limpa logs anteriores
    state.pendingRequests.clear();

    console.log(`[Universal MCP] Network capture enabled for session ${sessionId}`);

    return { success: true, message: 'Network capture enabled' };
  } catch (error) {
    throw new Error(`Failed to enable Network: ${error.message}`);
  }
}

/**
 * Habilita captura de Console
 */
async function enableConsoleCapture(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  try {
    // Habilita Runtime para mensagens do console
    await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Runtime.enable', {});
    // Habilita Log para logs do navegador
    await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Log.enable', {});

    state.consoleEnabled = true;
    state.consoleLogs = [];

    console.log(`[Universal MCP] Console capture enabled for session ${sessionId}`);

    return { success: true, message: 'Console capture enabled' };
  } catch (error) {
    throw new Error(`Failed to enable Console: ${error.message}`);
  }
}

/**
 * Habilita monitoramento de WebSocket
 */
async function enableWebSocketCapture(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  // WebSocket já é capturado pelo Network.enable
  if (!state.networkEnabled) {
    await enableNetworkCapture(sessionId);
  }

  state.wsEnabled = true;
  state.wsFrames = [];

  console.log(`[Universal MCP] WebSocket capture enabled for session ${sessionId}`);

  return { success: true, message: 'WebSocket capture enabled' };
}

/**
 * Retorna logs de Network
 */
function getNetworkLogs(sessionId, options = {}) {
  const state = debuggerState.get(sessionId);
  if (!state) {
    return { logs: [], count: 0 };
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

  // Limite
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  return {
    logs: logs.slice(offset, offset + limit),
    total: logs.length,
    hasMore: logs.length > offset + limit
  };
}

/**
 * Retorna logs do Console
 */
function getConsoleLogs(sessionId, options = {}) {
  const state = debuggerState.get(sessionId);
  if (!state) {
    return { logs: [], count: 0 };
  }

  let logs = state.consoleLogs;

  // Filtros
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
 * Retorna frames WebSocket
 */
function getWebSocketFrames(sessionId, options = {}) {
  const state = debuggerState.get(sessionId);
  if (!state) {
    return { frames: [], count: 0 };
  }

  let frames = state.wsFrames;

  // Filtros
  if (options.urlFilter) {
    frames = frames.filter(f => f.url?.includes(options.urlFilter));
  }
  if (options.direction) {
    frames = frames.filter(f => f.direction === options.direction);
  }

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  return {
    frames: frames.slice(offset, offset + limit),
    total: frames.length,
    hasMore: frames.length > offset + limit
  };
}

/**
 * Limpa logs
 */
function clearLogs(sessionId, type = 'all') {
  const state = debuggerState.get(sessionId);
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
 * Obtém métricas de performance
 */
async function getPerformanceMetrics(sessionId) {
  const session = automationSessions.get(sessionId);
  const state = initDebuggerState(sessionId);

  if (!session) throw new Error('Session not found');
  if (!state.attached) await attachDebugger(sessionId);

  try {
    // Habilita Performance domain se necessário
    await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Performance.enable', {});

    // Obtém métricas
    const { metrics } = await chrome.debugger.sendCommand(
      { tabId: session.tabId },
      'Performance.getMetrics',
      {}
    );

    // Formata métricas
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
async function evaluateInPage(sessionId, expression, options = {}) {
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
 * Intercepta requests (bloqueia, modifica headers, etc.)
 */
async function setRequestInterception(sessionId, patterns, enabled = true) {
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

// Listener para eventos do Debugger
chrome.debugger.onEvent.addListener((source, method, params) => {
  // Encontra a sessão pelo tabId
  let sessionId = null;
  for (const [sid, session] of automationSessions.entries()) {
    if (session.tabId === source.tabId) {
      sessionId = sid;
      break;
    }
  }

  if (!sessionId) return;

  const state = debuggerState.get(sessionId);
  if (!state) return;

  // Processa eventos de Network
  if (method === 'Network.requestWillBeSent') {
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

  if (method === 'Network.responseReceived') {
    const pending = state.pendingRequests.get(params.requestId);
    if (pending) {
      pending.status = params.response.status;
      pending.statusText = params.response.statusText;
      pending.responseHeaders = params.response.headers;
      pending.mimeType = params.response.mimeType;
      pending.timing = params.response.timing;
    }
  }

  if (method === 'Network.loadingFinished') {
    const pending = state.pendingRequests.get(params.requestId);
    if (pending) {
      pending.completed = true;
      pending.encodedDataLength = params.encodedDataLength;
      state.pendingRequests.delete(params.requestId);
    }
  }

  if (method === 'Network.loadingFailed') {
    const pending = state.pendingRequests.get(params.requestId);
    if (pending) {
      pending.failed = true;
      pending.errorText = params.errorText;
      state.pendingRequests.delete(params.requestId);
    }
  }

  // Eventos WebSocket
  if (method === 'Network.webSocketCreated') {
    const frame = {
      type: 'created',
      timestamp: Date.now(),
      url: params.url,
      requestId: params.requestId
    };
    if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
    state.wsFrames.push(frame);
  }

  if (method === 'Network.webSocketFrameSent') {
    const frame = {
      type: 'frame',
      direction: 'sent',
      timestamp: Date.now(),
      requestId: params.requestId,
      opcode: params.response.opcode,
      payloadData: params.response.payloadData?.substring(0, 10000) // Limita tamanho
    };
    if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
    state.wsFrames.push(frame);
  }

  if (method === 'Network.webSocketFrameReceived') {
    const frame = {
      type: 'frame',
      direction: 'received',
      timestamp: Date.now(),
      requestId: params.requestId,
      opcode: params.response.opcode,
      payloadData: params.response.payloadData?.substring(0, 10000)
    };
    if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
    state.wsFrames.push(frame);
  }

  if (method === 'Network.webSocketClosed') {
    const frame = {
      type: 'closed',
      timestamp: Date.now(),
      requestId: params.requestId
    };
    if (state.wsFrames.length >= state.maxLogs) state.wsFrames.shift();
    state.wsFrames.push(frame);
  }

  // Eventos de Console
  if (method === 'Runtime.consoleAPICalled') {
    const log = {
      type: 'console',
      level: params.type, // log, warn, error, info, debug
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

  if (method === 'Runtime.exceptionThrown') {
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

  if (method === 'Log.entryAdded') {
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
});

// Listener para quando o debugger é desanexado
chrome.debugger.onDetach.addListener((source, reason) => {
  for (const [sessionId, session] of automationSessions.entries()) {
    if (session.tabId === source.tabId) {
      const state = debuggerState.get(sessionId);
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
});

// Adiciona handlers para mensagens MCP de debugging
const originalHandleMCPMessage = handleMCPMessage;
handleMCPMessage = async function(message) {
  const { type, requestId, sessionId, mcpInstanceId, data } = message;

  let result = null;
  let success = true;
  let error = null;

  try {
    switch (type) {
      // ===== DEBUGGING COMMANDS =====
      case 'attach_debugger_command':
        result = await attachDebugger(data.sessionId || sessionId);
        break;

      case 'detach_debugger_command':
        result = await detachDebugger(data.sessionId || sessionId);
        break;

      case 'enable_network_command':
        result = await enableNetworkCapture(data.sessionId || sessionId);
        break;

      case 'enable_console_command':
        result = await enableConsoleCapture(data.sessionId || sessionId);
        break;

      case 'enable_websocket_command':
        result = await enableWebSocketCapture(data.sessionId || sessionId);
        break;

      case 'get_network_logs_command':
        result = getNetworkLogs(data.sessionId || sessionId, data.options || {});
        break;

      case 'get_console_logs_command':
        result = getConsoleLogs(data.sessionId || sessionId, data.options || {});
        break;

      case 'get_websocket_frames_command':
        result = getWebSocketFrames(data.sessionId || sessionId, data.options || {});
        break;

      case 'clear_logs_command':
        result = clearLogs(data.sessionId || sessionId, data.type || 'all');
        break;

      case 'get_performance_metrics_command':
        result = await getPerformanceMetrics(data.sessionId || sessionId);
        break;

      case 'evaluate_command':
        result = await evaluateInPage(data.sessionId || sessionId, data.expression, data.options || {});
        break;

      case 'set_request_interception_command':
        result = await setRequestInterception(
          data.sessionId || sessionId,
          data.patterns,
          data.enabled !== false
        );
        break;

      case 'get_debugger_status_command':
        const state = debuggerState.get(data.sessionId || sessionId);
        result = {
          attached: state?.attached || false,
          networkEnabled: state?.networkEnabled || false,
          consoleEnabled: state?.consoleEnabled || false,
          wsEnabled: state?.wsEnabled || false,
          networkLogsCount: state?.networkLogs?.length || 0,
          consoleLogsCount: state?.consoleLogs?.length || 0,
          wsFramesCount: state?.wsFrames?.length || 0
        };
        break;

      default:
        // Delega para o handler original
        return originalHandleMCPMessage(message);
    }
  } catch (e) {
    success = false;
    error = e.message;
    console.error('[Universal MCP] Error handling debug command:', e);
  }

  // Envia resposta
  // IMPORTANTE: Inclui mcpInstanceId para rotear a resposta de volta ao cliente correto
  if (requestId && mcpWebSocket && mcpWebSocket.readyState === WebSocket.OPEN) {
    mcpWebSocket.send(JSON.stringify({
      type: 'response',
      requestId,
      sessionId: '__background__',
      mcpInstanceId, // Inclui o ID da instância MCP que fez a requisição
      success,
      data: result,
      error
    }));
  }
};
