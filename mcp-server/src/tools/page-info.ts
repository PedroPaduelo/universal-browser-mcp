/**
 * Page information tools
 * - get_page_info
 * - get_page_title
 * - get_page_text
 * - get_page_snapshot
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';

export function registerPageInfoTools(mcpServer: McpServer, bridgeServer: BridgeServer) {
  mcpServer.tool(
    'get_page_info',
    `Get page structure: forms, buttons, inputs, clickable elements.

INPUT (all optional):
- includeForms, includeButtons, includeLinks, includeInputs, includeClickable (default: true)
- maxElements: Limit per category (default: 100)`,
    {
      includeForms: z.boolean().optional(),
      includeButtons: z.boolean().optional(),
      includeLinks: z.boolean().optional(),
      includeInputs: z.boolean().optional(),
      includeClickable: z.boolean().optional(),
      maxElements: z.number().optional()
    },
    async (params) => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Error: No session active.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'get_page_info', data: params }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_page_title',
    'Retorna o título da página atual.',
    {},
    async () => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'get_page_title', data: {} }, 5000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_page_text',
    'Retorna todo o texto visível da página ou de um elemento específico.',
    {
      selector: z.string().optional().describe('Seletor CSS do elemento (opcional, padrão: body)')
    },
    async ({ selector }) => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'get_page_text', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_page_snapshot',
    `Lightweight page state for AI context efficiency.
SIZE: ~2KB vs ~20KB for full get_page_info

WHEN TO USE:
- Quick page state check
- When you don't need full element list
- To minimize token usage in context
- Verify page loaded without full analysis

RETURNS:
- URL, title
- Visible text summary (first 1000 chars)
- Key interactive elements only (max 20)
- Current form values
- Basic metadata (has password, form count, etc.)

WORKFLOW:
navigate_to -> get_page_snapshot -> (if need details) get_page_info`,
    {},
    async () => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'get_page_snapshot', data: {} }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );
}
