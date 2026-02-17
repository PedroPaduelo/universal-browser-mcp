/**
 * Chrome event listeners for session lifecycle management
 * Monitors window/tab events and keeps session state in sync.
 */

import { automationSessions, windowToSession, debuggerState } from '../state.js';

/**
 * Initializes all session-related Chrome event listeners
 */
export function initSessionListeners() {
  // Monitor window closures
  chrome.windows.onRemoved.addListener((windowId) => {
    const sessionId = windowToSession.get(windowId);
    if (sessionId) {
      console.log(`[Universal MCP] Window closed, removing session: ${sessionId}`);
      automationSessions.delete(sessionId);
      windowToSession.delete(windowId);
      debuggerState.delete(sessionId);
    }
  });

  // Monitor tab closures
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    const sessionId = windowToSession.get(removeInfo.windowId);
    if (sessionId) {
      const session = automationSessions.get(sessionId);
      if (session && session.tabs.has(tabId)) {
        session.tabs.delete(tabId);
        console.log(`[Universal MCP] Tab ${tabId} removed from session ${sessionId}`);

        // If it was the active tab, switch to another
        if (session.activeTabId === tabId && session.tabs.size > 0) {
          session.activeTabId = session.tabs.keys().next().value;
        }
      }
    }
  });

  // Monitor navigation completions
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

  // Monitor active tab changes
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

  // Monitor tab creation (e.g. target="_blank")
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
