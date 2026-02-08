/**
 * Advanced debugging tools (DevTools Protocol)
 * - Network capture and logs
 * - Console capture and logs
 * - WebSocket capture
 * - Performance metrics
 * - Script evaluation
 * - Request interception
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerDebuggingTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'enable_network_capture',
    `Enable capture of ALL HTTP/HTTPS requests from the page.

CAPTURES:
- URLs, methods, headers
- Status codes, response headers
- Response time, size
- Resource type (XHR, Fetch, Script, etc.)

WHEN TO USE:
- API debugging
- Verify if requests are being made
- Analyze authentication headers
- Monitor network performance

IMPORTANT: Reload the page after enabling to capture initial requests.`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('enable_network_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_network_logs',
    `Returns captured HTTP request logs.

RETURNS:
- url, method, status
- headers (request and response)
- timing, size
- resourceType (XHR, Fetch, Document, etc.)

AVAILABLE FILTERS:
- urlFilter: Filter by URL (substring)
- method: GET, POST, PUT, etc.
- status: 200, 404, 500, etc.
- type: XHR, Fetch, Document, etc.
- limit: Maximum logs (default: 100)`,
    {
      urlFilter: z.string().optional().describe('Filter requests containing this string in the URL'),
      method: z.string().optional().describe('Filter by HTTP method (GET, POST, etc.)'),
      status: z.number().optional().describe('Filter by status code'),
      type: z.string().optional().describe('Filter by type (XHR, Fetch, Document, etc.)'),
      limit: z.number().optional().describe('Maximum logs to return (default: 100)')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_network_logs_command', {
          sessionId: session.browserSessionId,
          options: params
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'enable_console_capture',
    `Enable capture of ALL console logs from the page.

CAPTURES:
- console.log, console.warn, console.error
- console.info, console.debug
- Uncaught exceptions (uncaught errors)
- Browser logs

WHEN TO USE:
- Debug JavaScript errors
- Monitor application logs
- Capture stack traces
- Check warning messages`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('enable_console_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_console_logs',
    `Returns captured console logs.

RETURNS:
- level: log, warn, error, info, debug
- text: Message content
- timestamp: When it occurred
- stackTrace: Stack trace (for errors)

FILTERS:
- level: Filter by level (log, warn, error, etc.)
- textFilter: Filter by text (substring)
- limit: Maximum logs`,
    {
      level: z.string().optional().describe('Filter by level (log, warn, error, info, debug)'),
      textFilter: z.string().optional().describe('Filter logs containing this text'),
      limit: z.number().optional().describe('Maximum logs to return (default: 100)')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_console_logs_command', {
          sessionId: session.browserSessionId,
          options: params
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'enable_websocket_capture',
    `Enable capture of WebSocket frames.

CAPTURES:
- WebSocket connections created
- Frames sent and received
- Connection closures

WHEN TO USE:
- Debug real-time applications
- Monitor chat/messaging
- Analyze WebSocket protocols
- Debug Socket.IO, SignalR, etc.`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('enable_websocket_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_websocket_frames',
    `Returns captured WebSocket frames.

RETURNS:
- type: created, frame, closed
- direction: sent, received
- payloadData: Frame content
- timestamp: When it occurred

FILTERS:
- urlFilter: Filter by WebSocket URL
- direction: sent or received
- limit: Maximum frames`,
    {
      urlFilter: z.string().optional().describe('Filter by WebSocket URL'),
      direction: z.enum(['sent', 'received']).optional().describe('Filter by direction'),
      limit: z.number().optional().describe('Maximum frames to return (default: 100)')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_websocket_frames_command', {
          sessionId: session.browserSessionId,
          options: params
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_performance_metrics',
    `Returns page performance metrics.

METRICS INCLUDED:
- JSHeapUsedSize, JSHeapTotalSize (JS memory)
- Documents, Frames, Nodes (DOM)
- LayoutCount, RecalcStyleCount (rendering)
- TaskDuration (CPU time)

WHEN TO USE:
- Analyze memory usage
- Detect memory leaks
- Measure rendering performance`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_performance_metrics_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'evaluate_in_page',
    `Execute JavaScript in the page context via DevTools Protocol.

MORE POWERFUL than execute_script because:
- Accesses privileged APIs
- Can return complex objects
- Works even with restrictive CSP
- Accesses workers and iframes

EXAMPLES:
- "window.performance.timing"
- "localStorage.getItem('token')"
- "Array.from(document.cookies)"

RETURNS: Result of the JavaScript expression.`,
    {
      expression: z.string().describe('JavaScript expression to execute'),
      awaitPromise: z.boolean().optional().describe('Wait if it is a Promise (default: true)'),
      returnByValue: z.boolean().optional().describe('Return serialized value (default: true)')
    },
    async ({ expression, awaitPromise, returnByValue }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('evaluate_command', {
          sessionId: session.browserSessionId,
          expression,
          options: { awaitPromise, returnByValue }
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'clear_captured_logs',
    `Clear captured logs to free memory.

TYPES:
- all: Clear everything
- network: Only network logs
- console: Only console logs
- websocket: Only WebSocket frames`,
    {
      logType: z.enum(['all', 'network', 'console', 'websocket']).optional().describe('Type of log to clear (default: all)')
    },
    async ({ logType }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('clear_logs_command', {
          sessionId: session.browserSessionId,
          type: logType || 'all'
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_debugger_status',
    `Returns debugger status and captured log counts.

RETURNS:
- attached: Whether the debugger is attached
- networkEnabled, consoleEnabled, wsEnabled
- Log count for each type`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_debugger_status_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'set_request_interception',
    `Enable request interception for detailed analysis.

ALLOWS:
- View request/response body
- Modify headers
- Block requests
- Redirect URLs

PATTERNS:
- "*" - All URLs
- "*.api.com/*" - Specific domain
- "*/api/*" - Specific path

CAUTION: May affect page functionality.`,
    {
      enabled: z.boolean().optional().describe('Enable or disable (default: true)'),
      patterns: z.array(z.object({
        urlPattern: z.string()
      })).optional().describe('URL patterns to intercept')
    },
    async ({ enabled, patterns }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('set_request_interception_command', {
          sessionId: session.browserSessionId,
          enabled: enabled !== false,
          patterns
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'execute_script',
    `Execute custom JavaScript on the page. POWERFUL for complex cases.

WHEN TO USE:
- Fields with Lexical/Draft.js/Slate (rich text editors)
- Complex interactions that other tools cannot handle
- Manipulate Shadow DOM elements
- Dispatch custom events

EXAMPLES:

1. Insert text in Lexical field (WhatsApp):
{
  script: \`
    const editor = document.querySelector('[contenteditable="true"][data-tab="10"]');
    editor.focus();
    document.execCommand('insertText', false, 'My message');
  \`
}

2. Click send button:
{
  script: \`
    const btn = document.querySelector('[data-icon="send"]');
    btn?.click();
  \`
}

3. Return data:
{
  script: \`
    return document.querySelectorAll('.message').length;
  \`
}

RETURNS: The value returned by the script (or undefined if there is no return).
CAUTION: Malformed scripts can break the page.`,
    {
      script: z.string().describe('JavaScript code to execute on the page'),
      args: z.record(z.any()).optional().describe('Arguments to pass to the script (accessible via args)')
    },
    async ({ script, args }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        // Wrap script as async IIFE so `return` statements work, and pass args
        const argsJson = JSON.stringify(args || {});
        const expression = `(async function(args) { 'use strict';\n${script}\n})(${argsJson})`;

        const result = await bridgeServer.sendCommandToBackground('evaluate_command', {
          sessionId: session.browserSessionId,
          expression,
          options: { awaitPromise: true, returnByValue: true }
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error executing script: ${(error as Error).message}` }] };
      }
    }
  );
}
