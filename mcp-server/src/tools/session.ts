/**
 * Session management tools
 * - create_automation_session
 * - close_automation_session
 * - get_automation_status
 * - get_connection_status
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerSessionTools(
  mcpServer: McpServer,
  bridgeServer: BridgeServer,
  sessionManager: SessionManager
) {
  mcpServer.tool(
    'create_automation_session',
    `Create or reuse an automation session in a dedicated Chrome window.

IMPORTANT:
- ALWAYS call this tool first before any other automation operation
- If an automation window already exists, it will be REUSED (not creating a new one)
- The window is isolated from your normal browsing tabs

WORKFLOW:
1. create_automation_session (opens window)
2. navigate_to (go to URL)
3. get_page_info (understand the page)
4. fill_field, click_element, etc. (interact)
5. close_automation_session (when finished)

INPUT:
- url: Initial URL to open (default: about:blank)`,
    {
      url: z.string().url().optional().describe('Initial URL to open (default: about:blank)')
    },
    async ({ url }, extra) => {
      const mcpSessionId = extra.sessionId;
      if (!mcpSessionId) {
        return { content: [{ type: 'text', text: 'Error: No MCP session ID available.' }] };
      }

      // If this MCP session already has a browser session, reuse it
      const existingBrowserSessionId = sessionManager.getBrowserSessionId(mcpSessionId);
      if (existingBrowserSessionId && bridgeServer.isSessionConnected(existingBrowserSessionId)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sessionId: existingBrowserSessionId,
              reused: true,
              message: 'Reusing existing automation session.',
              tip: 'Use navigate_to to go to a different URL.'
            }, null, 2)
          }]
        };
      }

      // Query background for existing sessions to avoid creating duplicates
      let existingSessions: Array<{ sessionId: string }> = [];
      if (bridgeServer.isBackgroundConnected()) {
        try {
          const sessionsResult = await bridgeServer.sendCommandToBackground('get_sessions_command', {}, 3000) as { sessions?: Array<{ sessionId: string }> };
          existingSessions = sessionsResult?.sessions || [];
        } catch {
          // Ignore - will create new session
        }
      }

      // Create a new browser session for this MCP session
      const browserSessionId = sessionManager.createBrowserSession(mcpSessionId);
      bridgeServer.setCurrentSession(browserSessionId);

      if (!bridgeServer.isBackgroundConnected()) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Chrome extension not connected. Make sure the extension is installed and running.'
            }, null, 2)
          }]
        };
      }

      try {
        const result = await Promise.race([
          bridgeServer.createSessionViaBackground(browserSessionId, url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]) as { success?: boolean; error?: string; windowId?: number; activeTabId?: number; message?: string };

        if (result?.message?.includes('already exists') || result?.success) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: browserSessionId,
                windowId: result?.windowId,
                tabId: result?.activeTabId,
                message: result?.message || 'Session ready'
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result?.error || 'Failed to create session'
            }, null, 2)
          }]
        };

      } catch (error) {
        const errorMsg = (error as Error).message;
        if (errorMsg === 'Timeout') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                sessionId: browserSessionId,
                message: 'Session creation initiated. Window should be open.',
                tip: 'If window is not visible, check Chrome. Use navigate_to to continue.'
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: errorMsg
            }, null, 2)
          }]
        };
      }
    }
  );

  mcpServer.tool(
    'close_automation_session',
    'Close the current automation session and its dedicated browser window.',
    {},
    async (_params, extra) => {
      const mcpSessionId = extra.sessionId;
      if (!mcpSessionId) {
        return { content: [{ type: 'text', text: 'Error: No MCP session ID available.' }] };
      }
      const browserSessionId = sessionManager.getBrowserSessionId(mcpSessionId);

      if (!browserSessionId) {
        return {
          content: [{
            type: 'text',
            text: 'No active session to close.'
          }]
        };
      }

      try {
        // Send close command to background to actually close the browser window
        try {
          await bridgeServer.sendCommandToBackground('close_session_command', {
            sessionId: browserSessionId
          }, 5000);
        } catch (e) {
          // Even if command fails, still remove mapping
          console.error(`[Session] Failed to send close command: ${(e as Error).message}`);
        }

        sessionManager.removeSession(mcpSessionId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              closedSession: browserSessionId,
              message: 'Session closed. You can create a new one with create_automation_session.'
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error closing session: ${(error as Error).message}`
          }]
        };
      }
    }
  );

  mcpServer.tool(
    'get_automation_status',
    'Returns the status of the current automation session and all connected sessions.',
    {},
    async (_params, extra) => {
      const mcpSessionId = extra.sessionId ?? 'unknown';
      const browserSessionId = sessionManager.getBrowserSessionId(mcpSessionId);
      const connectedSessions = bridgeServer.getConnectedSessions();
      const sessionsInfo = bridgeServer.getSessionsInfo();
      const backgroundConnected = bridgeServer.isBackgroundConnected();
      const isServerMode = bridgeServer.isServer();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mcpSessionId,
            browserSessionId,
            mode: isServerMode ? 'server' : 'client',
            isConnected: browserSessionId ? bridgeServer.isSessionConnected(browserSessionId) : false,
            backgroundConnected,
            totalConnections: bridgeServer.getConnectionCount(),
            activeMcpSessions: sessionManager.getActiveCount(),
            connectedSessions,
            sessionsInfo,
            message: !backgroundConnected
              ? 'Extension not connected. Open Chrome and check the Universal Browser MCP extension.'
              : browserSessionId
                ? (bridgeServer.isSessionConnected(browserSessionId)
                  ? `Session active and connected! (mode: ${isServerMode ? 'server' : 'client'})`
                  : 'Session configured but waiting for browser connection')
                : 'Extension connected. Use create_automation_session to start.'
          }, null, 2)
        }]
      };
    }
  );

  mcpServer.tool(
    'get_connection_status',
    'Check the connection status with the browser and the current automation session.',
    {},
    async (_params, extra) => {
      const mcpSessionId = extra.sessionId ?? 'unknown';
      const browserSessionId = sessionManager.getBrowserSessionId(mcpSessionId);
      const isConnected = browserSessionId ? bridgeServer.isSessionConnected(browserSessionId) : false;
      const connectedSessions = bridgeServer.getConnectedSessions();
      const isServerMode = bridgeServer.isServer();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            mcpSessionId,
            browserSessionId,
            mode: isServerMode ? 'server' : 'client',
            isConnected,
            totalConnections: bridgeServer.getConnectionCount(),
            connectedSessions,
            message: isConnected
              ? `Connected to session ${browserSessionId}. Ready for automation! (mode: ${isServerMode ? 'server' : 'client'})`
              : browserSessionId
              ? `Session ${browserSessionId} configured but waiting for browser connection.`
              : 'No active session. Use create_automation_session to start.'
          }, null, 2)
        }]
      };
    }
  );
}
