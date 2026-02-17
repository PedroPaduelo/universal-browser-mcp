/**
 * Tab management functions for automation sessions
 * Handles opening, closing, switching, and querying tabs within sessions.
 */

import { automationSessions } from '../state.js';
import { cleanupDebuggerForTab } from '../session-manager.js';

/**
 * Opens a new tab in the session
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
 * Returns all tab handles for the session
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
      // Tab was closed, remove from registry
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
 * Switches to a specific tab
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
 * Closes a specific tab
 */
export async function closeTab(sessionId, tabId) {
  const session = automationSessions.get(sessionId);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (!session.tabs.has(tabId)) {
    return { success: false, error: `Tab ${tabId} not found in session` };
  }

  // Cannot close the last tab
  if (session.tabs.size === 1) {
    return { success: false, error: 'Cannot close the last tab. Use close_automation_session instead.' };
  }

  try {
    await cleanupDebuggerForTab(tabId);
    await chrome.tabs.remove(tabId);
    session.tabs.delete(tabId);

    // If the active tab was closed, switch to another
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
 * Returns the current active tab
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
