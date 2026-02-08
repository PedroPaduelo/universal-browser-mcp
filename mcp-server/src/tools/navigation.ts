/**
 * Navigation tools
 * - navigate_to
 * - go_back
 * - go_forward
 * - refresh
 * - get_current_url
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { NavigateToSchema } from '../schemas/index.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerNavigationTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'navigate_to',
    `Navigate to a URL in the automation window. Returns immediately.

INPUT:
- url: Full URL (e.g., "https://google.com")

WORKFLOW: navigate_to -> wait_for_element -> get_page_info`,
    { url: z.string().describe('Full URL to navigate to') },
    async ({ url }, extra) => {
      NavigateToSchema.parse({ url });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        await Promise.race([
          bridgeServer.sendCommandToBackground('navigate_command', { sessionId: session.browserSessionId, url }, 3000),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        return { content: [{ type: 'text', text: `Navigating to: ${url}` }] };
      } catch {
        return { content: [{ type: 'text', text: `Navigation started: ${url}` }] };
      }
    }
  );

  mcpServer.tool(
    'go_back',
    'Navigate back to the previous page in browser history.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'go_back', data: {} }, 5000);
      } catch { /* ignore timeout */ }
      return { content: [{ type: 'text', text: 'Navigating back to previous page...' }] };
    }
  );

  mcpServer.tool(
    'go_forward',
    'Navigate forward to the next page in browser history.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'go_forward', data: {} }, 5000);
      } catch { /* ignore timeout */ }
      return { content: [{ type: 'text', text: 'Navigating forward to next page...' }] };
    }
  );

  mcpServer.tool(
    'refresh',
    'Reload the current page.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'refresh', data: {} }, 5000);
      } catch { /* ignore timeout */ }
      return { content: [{ type: 'text', text: 'Reloading page...' }] };
    }
  );

  mcpServer.tool(
    'get_current_url',
    'Returns the current page URL in the automation session.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_current_url', data: {} }, 5000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );
}
