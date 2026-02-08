/**
 * Efficiency tools
 * - batch_actions
 * - get_accessibility_tree
 * - find_by_role
 * - highlight_element
 * - retry_action
 * - get_element_center
 * - take_screenshot
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import {
  BatchActionsSchema,
  FindByRoleSchema,
  HighlightElementSchema,
  RetryActionSchema,
  GetElementCenterSchema
} from '../schemas/index.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerEfficiencyTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'batch_actions',
    `Execute multiple browser actions in a single request.
Reduces round-trips for multi-step workflows by 60-80%.

WHEN TO USE:
- Fill form + submit in one call
- Navigate + wait + extract in sequence
- Any workflow with 3+ dependent actions
- When latency is critical

INPUT:
- actions: Array of { type: "tool_name", data: {...} } (max 20 actions)
- stopOnError: Stop on first error (default: true)

SUPPORTED ACTIONS:
Navigation: navigate_to, go_back, go_forward, refresh
Interaction: click_element, fill_field, type_text, select_option, press_key
Wait: wait_for_element, wait_for_text
Extraction: extract_text, extract_table, extract_links

EXAMPLE - Login flow:
{
  "actions": [
    { "type": "fill_field", "data": { "label": "Email", "value": "user@test.com" } },
    { "type": "fill_field", "data": { "label": "Password", "value": "secret" } },
    { "type": "click_element", "data": { "text": "Login" } },
    { "type": "wait_for_element", "data": { "selector": ".dashboard" } }
  ]
}

OUTPUT:
{
  "completed": true,
  "results": [{ "index": 0, "type": "fill_field", "success": true, "data": {...} }, ...],
  "summary": { "total": 4, "succeeded": 4, "failed": 0, "totalDuration": 1250 }
}`,
    {
      actions: z.array(z.object({
        type: z.string().describe('Action type (tool name)'),
        data: z.record(z.any()).optional().describe('Action parameters')
      })).min(1).max(20).describe('Array of actions to execute'),
      stopOnError: z.boolean().optional().describe('Stop on first error (default: true)')
    },
    async (params, extra) => {
      BatchActionsSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'batch_actions', data: params }, 60000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_accessibility_tree',
    `Returns page's accessibility tree - structured representation optimized for AI understanding.
FASTER than get_page_info for element discovery (3-10x improvement on large pages).

WHEN TO USE:
- Find elements by semantic role (button, textbox, link, etc.)
- More reliable than CSS selectors for dynamic pages
- Better understanding of page structure
- Find elements without knowing exact selectors

INPUT:
- maxDepth: How deep to traverse (default: 5)
- roles: Filter by roles (e.g., ["button", "link", "textbox"])
- root: Root element selector (default: body)

SUPPORTED ROLES:
button, link, textbox, checkbox, radio, combobox, listbox, option,
menuitem, menu, tab, tabpanel, dialog, heading, img, navigation,
main, form, search, alert, progressbar, slider, switch, grid, row, cell

OUTPUT:
{
  "tree": [
    { "role": "button", "name": "Submit", "selector": "...", "states": ["enabled"] },
    { "role": "textbox", "name": "Email", "selector": "...", "value": "" }
  ],
  "summary": { "button": 5, "link": 12, "textbox": 3 }
}

EXAMPLE - Find all buttons:
{ "roles": ["button"] }`,
    {
      maxDepth: z.number().optional().describe('Max traversal depth (default: 5)'),
      roles: z.array(z.string()).optional().describe('Filter by ARIA roles'),
      root: z.string().optional().describe('Root element selector (default: body)')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_accessibility_tree', data: params }, 15000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'find_by_role',
    `Find elements by ARIA role. More semantic than CSS selectors.

WHEN TO USE:
- Find all buttons, links, textboxes, etc.
- When CSS selectors are unreliable
- For accessibility-first automation
- Find elements by accessible name

ROLES: button, link, textbox, checkbox, combobox, listbox, menuitem,
       tab, dialog, heading, img, navigation, form, search, slider, etc.

INPUT:
- role: ARIA role (required)
- name: Accessible name filter (optional)

EXAMPLES:
- Find all buttons: { "role": "button" }
- Find Login button: { "role": "button", "name": "Login" }
- Find email field: { "role": "textbox", "name": "Email" }
- Find all links: { "role": "link" }

OUTPUT:
{
  "found": true,
  "count": 5,
  "elements": [
    { "role": "button", "name": "Submit", "selector": "...", "states": ["enabled"] }
  ]
}`,
    {
      role: z.string().describe('ARIA role to search for'),
      name: z.string().optional().describe('Filter by accessible name (partial match)')
    },
    async (params, extra) => {
      FindByRoleSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'find_by_role', data: params }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'highlight_element',
    `Visually highlight element for debugging.
Useful for verifying correct element selection.

INPUT:
- selector: Element to highlight (required)
- color: Highlight color (default: "red")
- duration: How long in ms (default: 2000)

WHEN TO USE:
- Debug which element will be clicked
- Verify selector targets correct element
- Visual confirmation during development`,
    {
      selector: z.string().describe('CSS selector of element to highlight'),
      color: z.string().optional().describe('Highlight color (default: "red")'),
      duration: z.number().optional().describe('Duration in ms (default: 2000)')
    },
    async (params, extra) => {
      HighlightElementSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(
          session.browserSessionId,
          { type: 'highlight_element', data: params },
          (params.duration || 2000) + 3000
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'retry_action',
    `Execute action with automatic retry on failure.
Useful for flaky operations.

INPUT:
- action: The action to execute { type: "tool_name", data: {...} }
- maxAttempts: Max retries (default: 3)
- delayMs: Delay between attempts (default: 1000)
- backoff: Use exponential backoff (default: false)

WHEN TO USE:
- Flaky network operations
- Elements that take variable time to appear
- Unstable page states

EXAMPLE:
{
  "action": { "type": "click_element", "data": { "selector": ".btn" } },
  "maxAttempts": 3,
  "delayMs": 500,
  "backoff": true
}`,
    {
      action: z.object({
        type: z.string(),
        data: z.record(z.any()).optional()
      }).describe('Action to execute with retry'),
      maxAttempts: z.number().optional().describe('Max retry attempts (default: 3)'),
      delayMs: z.number().optional().describe('Delay between attempts in ms (default: 1000)'),
      backoff: z.boolean().optional().describe('Use exponential backoff (default: false)')
    },
    async (params, extra) => {
      RetryActionSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const maxTime = (params.maxAttempts || 3) * (params.delayMs || 1000) * (params.backoff ? 4 : 1) + 30000;
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'retry_action', data: params }, maxTime);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_element_center',
    `Get center coordinates of element for precise clicking.

RETURNS:
- x, y: Center coordinates
- visible: If element is visible
- inViewport: If element is in viewport
- rect: Bounding rectangle

WHEN TO USE:
- Need precise click coordinates
- Debugging click issues
- Working with canvas or SVG elements`,
    {
      selector: z.string().describe('CSS selector of the element')
    },
    async ({ selector }, extra) => {
      GetElementCenterSchema.parse({ selector });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_element_center', data: { selector } }, 5000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'take_screenshot',
    `Captura um screenshot da página atual e salva em arquivo.

PARÂMETROS:
- savePath: Caminho completo onde salvar o arquivo (ex: /tmp/screenshot.jpg)
- format: 'jpeg' ou 'png' (padrão: 'jpeg' - menor tamanho)
- quality: 1-100 para JPEG (padrão: 50 - bom balanço qualidade/tamanho)

RETORNA:
- savedPath: Caminho do arquivo salvo
- size: Tamanho em bytes

ÚTIL PARA:
- Documentar estado da página
- Debug visual
- Verificar layout

DICA: Use quality baixo (30-50) para screenshots de debug, alto (80-100) para documentação.`,
    {
      savePath: z.string().describe('Caminho completo onde salvar o screenshot (ex: /tmp/screenshot.jpg)'),
      format: z.enum(['jpeg', 'png']).optional().describe('Formato da imagem: jpeg (menor) ou png (sem perda). Padrão: jpeg'),
      quality: z.number().min(1).max(100).optional().describe('Qualidade JPEG 1-100. Padrão: 50. Ignorado para PNG.')
    },
    async ({ savePath, format, quality }, extra) => {
      if (!bridgeServer.isBackgroundConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Extensão não conectada.' }] };
      }

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('take_screenshot_command', {
          sessionId: session.browserSessionId,
          format: format || 'jpeg',
          quality: quality || 50
        }) as { success: boolean; dataUrl?: string; error?: string };

        if (!result.success || !result.dataUrl) {
          return { content: [{ type: 'text', text: `Erro: ${result.error || 'Screenshot falhou'}` }] };
        }

        // Extrair dados base64 do dataUrl (formato: data:image/jpeg;base64,XXXX)
        const base64Data = result.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Criar diretório se não existir
        await mkdir(dirname(savePath), { recursive: true });

        // Salvar arquivo
        await writeFile(savePath, buffer);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              savedPath: savePath,
              size: buffer.length,
              sizeFormatted: buffer.length > 1024 * 1024
                ? `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`
                : `${(buffer.length / 1024).toFixed(2)} KB`
            }, null, 2)
          }]
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro ao capturar screenshot: ${(error as Error).message}` }] };
      }
    }
  );
}
