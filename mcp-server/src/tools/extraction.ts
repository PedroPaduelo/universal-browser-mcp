/**
 * Extraction tools
 * - extract_text, extract_table, extract_links, extract_form_data
 * - extract_styles, extract_html
 * - validate_page
 * - get_stylesheets
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import {
  ExtractTextSchema,
  ExtractTableSchema,
  ExtractStylesSchema,
  ExtractHtmlSchema,
  ValidatePageSchema
} from '../schemas/index.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerExtractionTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'extract_text',
    `Extract text content from a specific element.

WHEN TO USE:
- Get text from a specific container
- Extract error messages, success messages
- Read specific content areas

INPUT:
- selector: CSS selector of the element

OUTPUT:
{ "text": "extracted text content", "selector": "..." }

EXAMPLE:
{ "selector": ".error-message" }`,
    {
      selector: z.string().describe('CSS selector of the element')
    },
    async ({ selector }, extra) => {
      ExtractTextSchema.parse({ selector });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'extract_text', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_table',
    `Extract HTML table data as structured JSON.

WHEN TO USE:
- Extract data from HTML tables
- Scrape tabular information
- Get pricing tables, data grids, etc.

INPUT:
- selector: CSS selector of the table (default: first table on page)

OUTPUT:
{
  "headers": ["Column 1", "Column 2", ...],
  "rows": [
    ["value1", "value2", ...],
    ...
  ],
  "rowCount": 10
}

EXAMPLE:
{ "selector": ".data-table" }`,
    {
      selector: z.string().optional().describe('CSS selector of the table (default: first table)')
    },
    async ({ selector }, extra) => {
      ExtractTableSchema.parse({ selector });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'extract_table', data: { selector } }, 15000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_links',
    'Extract all links from a page or section.',
    {
      selector: z.string().optional().describe('Container selector (default: entire page)'),
      limit: z.number().optional().describe('Maximum links (default: 100)')
    },
    async ({ selector, limit }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'extract_links', data: { selector, limit } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_form_data',
    'Extract current form field values.',
    {
      selector: z.string().optional().describe('Form selector (default: first form)')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'extract_form_data', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_styles',
    'Extract CSS styles from an element or the entire page. Returns inline styles, CSS classes, and computed styles.',
    {
      selector: z.string().optional().describe('CSS selector of the element (default: entire page)'),
      includeComputed: z.boolean().optional().describe('Include computed styles (default: true)'),
      includeInline: z.boolean().optional().describe('Include inline styles (default: true)'),
      includeClasses: z.boolean().optional().describe('Include CSS classes (default: true)')
    },
    async (params, extra) => {
      ExtractStylesSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'extract_styles', data: params }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_html',
    'Extract HTML code from an element or the entire page.',
    {
      selector: z.string().optional().describe('CSS selector of the element (default: html)'),
      outerHtml: z.boolean().optional().describe('Include wrapper element (true) or only inner content (false)')
    },
    async (params, extra) => {
      ExtractHtmlSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'extract_html', data: params }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'validate_page',
    'Validate page structure and styles according to specified rules. Useful for verifying if a page is correctly implemented.',
    {
      selector: z.string().optional().describe('Container selector to validate (default: body)'),
      rules: z.array(z.object({
        type: z.enum(['element_exists', 'element_count', 'has_class', 'has_style', 'has_attribute', 'text_contains', 'text_equals']).describe('Validation type'),
        selector: z.string().describe('Element selector to validate'),
        expected: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Expected value'),
        property: z.string().optional().describe('CSS property or attribute to check'),
        description: z.string().optional().describe('Rule description for the report')
      })).optional().describe('List of validation rules')
    },
    async (params, extra) => {
      ValidatePageSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'validate_page', data: params }, 30000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_stylesheets',
    'List all loaded stylesheets (CSS) on the page.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_stylesheets', data: {} }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );
}
