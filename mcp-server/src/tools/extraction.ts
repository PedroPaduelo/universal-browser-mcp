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

export function registerExtractionTools(mcpServer: McpServer, bridgeServer: BridgeServer) {
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
    async ({ selector }) => {
      ExtractTextSchema.parse({ selector });

      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'extract_text', data: { selector } }, 10000);
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
    async ({ selector }) => {
      ExtractTableSchema.parse({ selector });

      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'extract_table', data: { selector } }, 15000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_links',
    'Extrai todos os links de uma página ou seção.',
    {
      selector: z.string().optional().describe('Seletor do container (padrão: página toda)'),
      limit: z.number().optional().describe('Máximo de links (padrão: 100)')
    },
    async ({ selector, limit }) => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'extract_links', data: { selector, limit } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_form_data',
    'Extrai os valores atuais de um formulário.',
    {
      selector: z.string().optional().describe('Seletor do formulário (padrão: primeiro form)')
    },
    async ({ selector }) => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'extract_form_data', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_styles',
    'Extrai estilos CSS de um elemento ou da página inteira. Retorna estilos inline, classes CSS e estilos computados.',
    {
      selector: z.string().optional().describe('Seletor CSS do elemento (padrão: página inteira)'),
      includeComputed: z.boolean().optional().describe('Incluir estilos computados (padrão: true)'),
      includeInline: z.boolean().optional().describe('Incluir estilos inline (padrão: true)'),
      includeClasses: z.boolean().optional().describe('Incluir classes CSS (padrão: true)')
    },
    async (params) => {
      ExtractStylesSchema.parse(params);

      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'extract_styles', data: params }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'extract_html',
    'Extrai o código HTML de um elemento ou da página inteira.',
    {
      selector: z.string().optional().describe('Seletor CSS do elemento (padrão: html)'),
      outerHtml: z.boolean().optional().describe('Incluir elemento wrapper (true) ou só conteúdo interno (false)')
    },
    async (params) => {
      ExtractHtmlSchema.parse(params);

      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'extract_html', data: params }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'validate_page',
    'Valida a estrutura e estilos da página conforme regras especificadas. Útil para verificar se uma página foi programada corretamente.',
    {
      selector: z.string().optional().describe('Seletor do container a validar (padrão: body)'),
      rules: z.array(z.object({
        type: z.enum(['element_exists', 'element_count', 'has_class', 'has_style', 'has_attribute', 'text_contains', 'text_equals']).describe('Tipo de validação'),
        selector: z.string().describe('Seletor do elemento a validar'),
        expected: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Valor esperado'),
        property: z.string().optional().describe('Propriedade CSS ou atributo a verificar'),
        description: z.string().optional().describe('Descrição da regra para o relatório')
      })).optional().describe('Lista de regras de validação')
    },
    async (params) => {
      ValidatePageSchema.parse(params);

      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'validate_page', data: params }, 30000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_stylesheets',
    'Lista todas as folhas de estilo (CSS) carregadas na página.',
    {},
    async () => {
      if (!bridgeServer.isConnected()) {
        return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
      }

      try {
        const result = await bridgeServer.sendAndWait({ type: 'get_stylesheets', data: {} }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );
}
