/**
 * Tab management tools (handles)
 * - open_new_tab
 * - get_tab_handles
 * - switch_to_tab
 * - close_tab
 * - get_current_tab
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerTabTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'open_new_tab',
    `Open a new tab in the automation session.

USEFUL FOR:
- Opening multiple pages simultaneously
- Comparing content
- Navigating links that open in new tabs

EXAMPLE:
{ url: "https://github.com", switchTo: true }`,
    {
      url: z.string().optional().describe('URL to open in the new tab (default: about:blank)'),
      switchTo: z.boolean().optional().describe('Switch to the new tab after creating (default: true)')
    },
    async ({ url, switchTo }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('open_new_tab_command', {
          sessionId: session.browserSessionId,
          url,
          switchTo: switchTo !== false
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_tab_handles',
    `Returns all open tabs in the automation session.

RETURNS:
- List of tabs with tabId, url, title
- Which tab is active
- Total tab count

USEFUL FOR:
- See how many tabs are open
- Get tab IDs for switch_to_tab
- Check URLs of each tab`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_tab_handles_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'switch_to_tab',
    `Switch to a specific tab in the session.

PARAMETERS:
- tabId: Tab ID (obtained via get_tab_handles)

EXAMPLE:
{ tabId: 12345 }`,
    {
      tabId: z.number().describe('Tab ID to switch to (obtained via get_tab_handles)')
    },
    async ({ tabId }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('switch_to_tab_command', { sessionId: session.browserSessionId, tabId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'close_tab',
    `Close a specific tab in the session.

NOTE: Cannot close the last tab. Use close_automation_session for that.

EXAMPLE:
{ tabId: 12345 }`,
    {
      tabId: z.number().describe('Tab ID to close (obtained via get_tab_handles)')
    },
    async ({ tabId }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('close_tab_command', { sessionId: session.browserSessionId, tabId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_current_tab',
    'Returns information about the currently active tab.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_current_tab_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );
}
