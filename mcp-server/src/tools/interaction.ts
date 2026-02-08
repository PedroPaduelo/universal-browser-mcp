/**
 * Interaction tools
 * - fill_field, fill_form
 * - click_element, double_click
 * - select_option
 * - type_text
 * - hover_element
 * - scroll_to
 * - press_key
 * - focus_element
 * - get_active_element
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import {
  FillFieldSchema,
  FillFormSchema,
  ClickElementSchema,
  SelectOptionSchema,
  TypeTextSchema
} from '../schemas/index.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerInteractionTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'fill_field',
    `Fill a form field.

INPUT:
- selector: CSS selector OR
- label: Visible label text
- value: Value to fill (required)`,
    {
      selector: z.string().optional().describe('CSS selector'),
      label: z.string().optional().describe('Label text'),
      value: z.string().describe('Value to fill')
    },
    async (params, extra) => {
      FillFieldSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'fill_field', data: params }, 10000);
        return { content: [{ type: 'text', text: `Filled: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'fill_form',
    'Preenche múltiplos campos de um formulário de uma vez.',
    {
      fields: z.array(z.object({
        selector: z.string().optional(),
        label: z.string().optional(),
        value: z.string()
      })).describe('Array de campos com selector/label e value')
    },
    async ({ fields }, extra) => {
      FillFormSchema.parse({ fields });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'fill_form', data: { fields } }, 15000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro ao preencher formulário: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'click_element',
    `Click an element by selector or text.

INPUT (provide ONE):
- selector: CSS selector (e.g., "[data-testid='btn']")
- text: Visible text (e.g., "Login")
- clickParent: Auto-find clickable parent (default: true)`,
    {
      selector: z.string().optional().describe('CSS selector'),
      text: z.string().optional().describe('Visible text'),
      clickParent: z.boolean().optional()
    },
    async (params, extra) => {
      ClickElementSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'click_element', data: params }, 10000);
        return { content: [{ type: 'text', text: `Clicked: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'double_click',
    `Executa clique duplo em um elemento. Útil para:
- Selecionar palavras em campos de texto
- Abrir itens em listas
- Editar células de tabelas`,
    {
      selector: z.string().optional().describe('Seletor CSS do elemento'),
      text: z.string().optional().describe('Texto visível do elemento')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'double_click', data: params }, 10000);
        return { content: [{ type: 'text', text: `Clique duplo: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'select_option',
    'Seleciona uma opção em um dropdown/select.',
    {
      selector: z.string().optional().describe('Seletor CSS do select'),
      label: z.string().optional().describe('Label do campo select'),
      value: z.string().optional().describe('Valor (value) da opção'),
      text: z.string().optional().describe('Texto visível da opção')
    },
    async (params, extra) => {
      SelectOptionSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'select_option', data: params }, 10000);
        return { content: [{ type: 'text', text: `Opção selecionada: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro ao selecionar: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'type_text',
    `Type text character by character, simulating real keyboard input.

WHEN TO USE vs fill_field:
- fill_field: Instant fill (faster, works for most fields)
- type_text: Character-by-character (slower, but triggers autocomplete/validation)

USE type_text FOR:
- Search fields with autocomplete (Google, etc.)
- Fields that validate while typing
- Fields that trigger suggestions
- When fill_field doesn't work

INPUT:
- selector or label: Field to type into (provide one)
- text: Text to type
- delay: Delay between keystrokes in ms (default: 50)

EXAMPLE:
{ "label": "Search", "text": "search term", "delay": 100 }

WORKFLOW:
focus_element (optional) -> type_text -> wait for autocomplete -> click suggestion`,
    {
      selector: z.string().optional().describe('CSS selector of the field'),
      label: z.string().optional().describe('Label text of the field'),
      text: z.string().describe('Text to type'),
      delay: z.number().optional().describe('Delay between keystrokes in ms (default: 50)')
    },
    async (params, extra) => {
      TypeTextSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'type_text', data: params }, 30000);
        return { content: [{ type: 'text', text: `Text typed: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error typing: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'hover_element',
    'Move o mouse sobre um elemento (hover).',
    {
      selector: z.string().describe('Seletor CSS do elemento')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'hover_element', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: `Hover realizado: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro no hover: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'scroll_to',
    'Rola a página até um elemento ou posição.',
    {
      selector: z.string().optional().describe('Seletor CSS do elemento'),
      x: z.number().optional().describe('Posição X em pixels'),
      y: z.number().optional().describe('Posição Y em pixels')
    },
    async ({ selector, x, y }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      const data = selector ? { selector } : { position: { x, y } };

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'scroll_to', data }, 5000);
        return { content: [{ type: 'text', text: `Scroll realizado: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro no scroll: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'press_key',
    `Pressiona uma tecla do teclado. Útil para:
- Confirmar ações (Enter)
- Cancelar/fechar modais (Escape)
- Navegar entre campos (Tab)
- Navegar em listas (ArrowUp, ArrowDown)
- Deletar texto (Backspace, Delete)

TECLAS SUPORTADAS:
Enter, Escape, Tab, Backspace, Delete, Space,
ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
Home, End, PageUp, PageDown

EXEMPLOS:
- Confirmar busca: { key: "Enter" }
- Fechar modal: { key: "Escape" }
- Próximo campo: { key: "Tab" }
- Ctrl+A: { key: "a", modifiers: { ctrl: true } }`,
    {
      key: z.string().describe('Tecla a pressionar (Enter, Escape, Tab, ArrowDown, etc.)'),
      selector: z.string().optional().describe('Seletor do elemento (opcional, usa elemento focado se não informado)'),
      modifiers: z.object({
        ctrl: z.boolean().optional(),
        shift: z.boolean().optional(),
        alt: z.boolean().optional(),
        meta: z.boolean().optional()
      }).optional().describe('Modificadores (ctrl, shift, alt, meta)')
    },
    async ({ key, selector, modifiers }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'press_key', data: { key, selector, modifiers } }, 5000);
        return { content: [{ type: 'text', text: `Tecla pressionada: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro ao pressionar tecla: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'focus_element',
    `Foca em um elemento da página. Útil antes de usar press_key.`,
    {
      selector: z.string().describe('Seletor CSS do elemento')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'focus_element', data: { selector } }, 5000);
        return { content: [{ type: 'text', text: `Elemento focado: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_active_element',
    `Retorna informações sobre o elemento atualmente focado na página.`,
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_active_element', data: {} }, 5000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_element_info',
    `Retorna informações detalhadas de um elemento específico.

ÚTIL PARA:
- Descobrir seletores alternativos para um elemento
- Verificar se elemento está visível, habilitado, focado
- Obter atributos data-*, aria-*, etc.
- Entender a estrutura do elemento antes de interagir

RETORNA:
- tagName, id, className, name, type, value
- Atributos data-* e ARIA
- Estados (isVisible, isEnabled, isChecked, isFocused)
- Posição e tamanho
- Seletores alternativos

EXEMPLO:
{ selector: "span[title='Maruann']" }`,
    {
      selector: z.string().describe('Seletor CSS do elemento')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_element_info', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );
}
