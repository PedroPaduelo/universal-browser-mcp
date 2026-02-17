/**
 * Wait tools
 * - wait_for_element
 * - wait_for_text
 * - smart_wait
 * - page_ready
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { WaitForTextSchema } from '../schemas/index.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerWaitTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'wait_for_element',
    `Wait for element to appear and be visible.

INPUT:
- selector: CSS selector (required)
- timeout: Max wait ms (default: 10000, max: 30000)`,
    {
      selector: z.string().describe('CSS selector'),
      timeout: z.number().optional().describe('Timeout ms (default: 10000)')
    },
    async ({ selector, timeout }, extra) => {
      const effectiveTimeout = Math.min(timeout || 10000, 30000);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(
          session.browserSessionId,
          { type: 'wait_for_element', data: { selector, timeout: effectiveTimeout } },
          effectiveTimeout + 2000
        );
        return { content: [{ type: 'text', text: `Found: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Timeout or error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'wait_for_text',
    'Wait for specific text to appear on the page.',
    {
      text: z.string().describe('Text to wait for'),
      selector: z.string().optional().describe('Container selector (optional)'),
      timeout: z.number().optional().describe('Timeout in ms (default: 10000, max: 60000)')
    },
    async ({ text, selector, timeout }, extra) => {
      const effectiveTimeout = Math.min(timeout || 10000, 60000);
      WaitForTextSchema.parse({ text, selector, timeout: effectiveTimeout });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const bridgeTimeout = effectiveTimeout + 3000;

        const result = await bridgeServer.sendAndWaitToSession(
          session.browserSessionId,
          { type: 'wait_for_text', data: { text, selector, timeout: effectiveTimeout } },
          bridgeTimeout
        );
        return { content: [{ type: 'text', text: `Text found: ${JSON.stringify(result)}` }] };
      } catch (error) {
        const errorMsg = (error as Error).message;
        if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
          return {
            content: [{
              type: 'text',
              text: `Timeout waiting for text "${text}" (${effectiveTimeout}ms). Check if the text exists on the page.`
            }]
          };
        }
        return { content: [{ type: 'text', text: `Error: ${errorMsg}` }] };
      }
    }
  );

  mcpServer.tool(
    'smart_wait',
    `Intelligent wait with multiple conditions. More powerful than wait_for_element.

WHEN TO USE:
- Wait for multiple conditions simultaneously
- Complex page load scenarios
- Wait for network to settle
- Wait for loading indicators to disappear

CONDITIONS:
- { type: "element", selector: "..." } - Element present and visible
- { type: "text", text: "...", selector: "..." } - Text appears
- { type: "url_contains", value: "..." } - URL contains string
- { type: "url_equals", value: "..." } - URL matches exactly
- { type: "network_idle", duration: 500 } - No network for duration
- { type: "no_loading_spinner", selector: ".spinner" } - Spinner gone
- { type: "element_hidden", selector: "..." } - Element hidden/removed
- { type: "element_enabled", selector: "..." } - Element not disabled
- { type: "dom_stable", duration: 500 } - No DOM changes for duration
- { type: "element_count", selector: "...", count: 5, operator: "gte" }

INPUT:
- conditions: Array of conditions
- logic: "all" (default) or "any"
- timeout: Max wait in ms (default: 10000)

EXAMPLE - Wait for page load:
{
  "conditions": [
    { "type": "element", "selector": ".main-content" },
    { "type": "no_loading_spinner" },
    { "type": "network_idle", "duration": 500 }
  ],
  "logic": "all",
  "timeout": 15000
}`,
    {
      conditions: z.array(z.object({
        type: z.string(),
        selector: z.string().optional(),
        text: z.string().optional(),
        value: z.string().optional(),
        pattern: z.string().optional(),
        duration: z.number().optional(),
        count: z.number().optional(),
        operator: z.string().optional(),
        attribute: z.string().optional(),
        exact: z.boolean().optional(),
        state: z.string().optional()
      })).describe('Array of conditions to check'),
      logic: z.enum(['all', 'any']).optional().describe('Logic: "all" (AND) or "any" (OR)'),
      timeout: z.number().optional().describe('Max wait in ms (default: 10000)'),
      pollInterval: z.number().optional().describe('Check interval in ms (default: 100)')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const effectiveTimeout = Math.min(params.timeout || 10000, 60000);
        const result = await bridgeServer.sendAndWaitToSession(
          session.browserSessionId,
          { type: 'smart_wait', data: { ...params, timeout: effectiveTimeout } },
          effectiveTimeout + 5000
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'page_ready',
    `Wait for page to be fully loaded and interactive.
Combines multiple readiness checks in one call.

CHECKS PERFORMED:
- document.readyState === 'complete'
- No pending network requests (optional)
- No loading spinners visible (optional)
- DOM is stable (no mutations for stabilityDuration)

WHEN TO USE:
- After navigate_to before any interaction
- After actions that trigger full page reload
- When unsure if page is ready

INPUT:
- timeout: Max wait in ms (default: 30000)
- checkNetwork: Check for network idle (default: true)
- checkSpinners: Check for loading spinners (default: true)
- stabilityDuration: DOM stability duration in ms (default: 500)

EXAMPLE:
{ "timeout": 15000, "checkSpinners": true }`,
    {
      timeout: z.number().optional().describe('Max wait in ms (default: 30000)'),
      checkNetwork: z.boolean().optional().describe('Check for network idle (default: true)'),
      checkSpinners: z.boolean().optional().describe('Check for loading spinners (default: true)'),
      stabilityDuration: z.number().optional().describe('DOM stability duration in ms (default: 500)')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const effectiveTimeout = Math.min(params.timeout || 30000, 60000);
        const result = await bridgeServer.sendAndWaitToSession(
          session.browserSessionId,
          { type: 'page_ready', data: { ...params, timeout: effectiveTimeout } },
          effectiveTimeout + 5000
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );
}
