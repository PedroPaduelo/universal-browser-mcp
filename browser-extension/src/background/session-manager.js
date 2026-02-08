/**
 * Core automation session management
 * Handles session creation, teardown, navigation, screenshots, and session queries.
 *
 * Tab management is delegated to ./session/tab-manager.js
 * Chrome event listeners are in ./session/session-listeners.js
 */

import { automationSessions, windowToSession, debuggerState } from './state.js';

// Re-export tab management functions
export { openNewTab, getTabHandles, switchToTab, closeTab, getCurrentTab } from './session/tab-manager.js';

// Re-export listener initializer
export { initSessionListeners } from './session/session-listeners.js';

/**
 * Cleans up the debugger attached to a tab
 */
export async function cleanupDebuggerForTab(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    console.log(`[Universal MCP] Detached debugger from tab ${tabId}`);
  } catch (e) {
    // Ignore error if debugger was not attached
  }
}

/**
 * Creates a new automation session with a dedicated window
 */
export async function createAutomationSession(sessionId, url = 'about:blank') {
  // Check if a session with this ID already exists
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

  // Create new window
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

  // Structure with multi-tab support
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
 * Closes an automation session
 */
export async function closeAutomationSession(sessionId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  // Clean up debugger from all tabs
  for (const tabId of session.tabs.keys()) {
    await cleanupDebuggerForTab(tabId);
  }

  try {
    await chrome.windows.remove(session.windowId);
  } catch (e) {
    // Window was already closed manually
  }

  automationSessions.delete(sessionId);
  windowToSession.delete(session.windowId);
  debuggerState.delete(sessionId);

  console.log(`[Universal MCP] Closed automation session: ${sessionId}`);

  return { success: true, message: 'Session closed' };
}

/**
 * Captures a screenshot of the active tab
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
 * Navigates to a URL in the active tab
 * Starts navigation and returns immediately (non-blocking)
 */
export async function navigateInSession(sessionId, url) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const tabId = session.activeTabId;

  try {
    // Start navigation
    await chrome.tabs.update(tabId, { url });

    // Return immediately after starting navigation
    // The client should use wait_for_element or page_ready to synchronize
    return {
      success: true,
      tabId,
      url,
      message: 'Navigation started. Use wait_for_element or page_ready to wait for page load.'
    };
  } catch (error) {
    return {
      success: false,
      tabId,
      url,
      error: error.message
    };
  }
}

/**
 * Returns information about a session
 */
export function getSessionInfo(sessionId) {
  const session = automationSessions.get(sessionId);
  if (!session) return null;

  return {
    windowId: session.windowId,
    tabId: session.activeTabId, // For backward compatibility
    activeTabId: session.activeTabId,
    tabCount: session.tabs.size,
    createdAt: session.createdAt
  };
}

/**
 * Lists all active sessions
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
