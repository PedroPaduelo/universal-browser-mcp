/**
 * Handler de mensagens do MCP Server e Chrome Runtime
 */

import { automationSessions, windowToSession } from './state.js';
import {
  createAutomationSession,
  closeAutomationSession,
  takeScreenshotOfSession,
  navigateInSession,
  listSessions,
  openNewTab,
  getTabHandles,
  switchToTab,
  closeTab,
  getCurrentTab
} from './session-manager.js';
import {
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
  setRequestInterception,
  clearLogs
} from './debugger/index.js';
import { sendResponse } from './websocket-client.js';

/**
 * Processa mensagens do servidor MCP
 */
export async function handleMCPMessage(message) {
  const { type, requestId, sessionId, mcpInstanceId, data } = message;

  console.log('[Universal MCP] Received from MCP:', type, sessionId, mcpInstanceId ? `(from: ${mcpInstanceId})` : '');

  if (sessionId && sessionId !== '__background__' && !sessionId.startsWith('session_')) {
    return;
  }

  let result = null;
  let success = true;
  let error = null;

  try {
    switch (type) {
      // Session commands
      case 'create_session_command':
        result = await createAutomationSession(data.sessionId, data.url);
        break;

      case 'close_session_command':
        result = await closeAutomationSession(data.sessionId);
        break;

      case 'get_sessions_command':
        result = { sessions: listSessions() };
        break;

      // Tab management commands
      case 'open_new_tab_command':
        result = await openNewTab(data.sessionId, data.url, data.switchTo !== false);
        break;

      case 'get_tab_handles_command':
        result = await getTabHandles(data.sessionId);
        break;

      case 'switch_to_tab_command':
        result = await switchToTab(data.sessionId, data.tabId);
        break;

      case 'close_tab_command':
        result = await closeTab(data.sessionId, data.tabId);
        break;

      case 'get_current_tab_command':
        result = getCurrentTab(data.sessionId);
        break;

      case 'take_screenshot_command':
        result = await takeScreenshotOfSession(data?.sessionId, data?.format, data?.quality);
        break;

      case 'navigate_command':
        result = await navigateInSession(data.sessionId, data.url);
        break;

      case 'ping':
        result = { pong: true, timestamp: Date.now() };
        break;

      // Debugger commands
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
        result = getDebuggerStatus(data.sessionId || sessionId);
        break;

      default:
        return;
    }
  } catch (e) {
    success = false;
    error = e.message;
    console.error('[Universal MCP] Error handling MCP message:', e);
  }

  // IMPORTANTE: Inclui mcpInstanceId na resposta para roteamento correto
  if (requestId) {
    sendResponse(requestId, success, result, error, mcpInstanceId);
  }
}

/**
 * Processa mensagens do Chrome Runtime (popup, content scripts)
 */
export function handleRuntimeMessage(message, sender, sendResponse) {
  console.log('[Universal MCP] Background received:', message.type);

  switch (message.type) {
    case 'get_status':
      sendResponse({
        status: 'ok',
        activeSessions: automationSessions.size,
        sessions: Array.from(automationSessions.entries()).map(([id, data]) => ({
          sessionId: id,
          windowId: data.windowId,
          tabId: data.activeTabId
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
        chrome.tabs.get(session.activeTabId, (tab) => {
          sendResponse({
            success: true,
            session: {
              sessionId: message.sessionId,
              windowId: session.windowId,
              tabId: session.activeTabId,
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
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;

      if (windowId && windowToSession.has(windowId)) {
        const sessionId = windowToSession.get(windowId);
        const sessionData = automationSessions.get(sessionId);

        if (sessionData && sessionData.activeTabId === tabId) {
          sendResponse({ isAutomationTab: true, sessionId });
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
      sendResponse({ sessions: listSessions() });
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
}

/**
 * Inicializa o listener de mensagens
 */
export function initMessageListener() {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}
