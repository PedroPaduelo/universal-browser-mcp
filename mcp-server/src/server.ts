#!/usr/bin/env node

/**
 * Universal Browser MCP Server
 * Permite ao Claude controlar qualquer página web via Chrome Extension
 * Suporta múltiplas sessões isoladas para múltiplos Claude Code
 *
 * Modo de operação: HTTP/SSE (Server-Sent Events)
 * - Porta 8080: Servidor HTTP/SSE para clientes MCP
 * - Porta 3002: WebSocket bridge para a extensão do browser
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { BridgeServer } from './websocket/bridge-server.js';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// Schemas de validação
const NavigateToSchema = z.object({
  url: z.string().url('URL inválida')
});

const SelectorOrLabelSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional()
}).refine(data => data.selector || data.label, {
  message: 'Forneça selector ou label'
});

const FillFieldSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional(),
  value: z.string()
}).refine(data => data.selector || data.label, {
  message: 'Forneça selector ou label'
});

const FillFormSchema = z.object({
  fields: z.array(z.object({
    selector: z.string().optional(),
    label: z.string().optional(),
    value: z.string()
  }))
});

const ClickElementSchema = z.object({
  selector: z.string().optional(),
  text: z.string().optional()
}).refine(data => data.selector || data.text, {
  message: 'Forneça selector ou text'
});

const SelectOptionSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional()
});

const WaitForElementSchema = z.object({
  selector: z.string(),
  timeout: z.number().optional().default(10000)
});

const WaitForTextSchema = z.object({
  text: z.string(),
  selector: z.string().optional(),
  timeout: z.number().optional().default(10000)
});

const ExtractTextSchema = z.object({
  selector: z.string()
});

const ExtractTableSchema = z.object({
  selector: z.string().optional()
});

const ExtractStylesSchema = z.object({
  selector: z.string().optional(),
  includeComputed: z.boolean().optional().default(true),
  includeInline: z.boolean().optional().default(true),
  includeClasses: z.boolean().optional().default(true)
});

const ExtractHtmlSchema = z.object({
  selector: z.string().optional(),
  outerHtml: z.boolean().optional().default(true)
});

const ValidatePageSchema = z.object({
  selector: z.string().optional(),
  rules: z.array(z.object({
    type: z.enum(['element_exists', 'element_count', 'has_class', 'has_style', 'has_attribute', 'text_contains', 'text_equals']),
    selector: z.string(),
    expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
    property: z.string().optional(),
    description: z.string().optional()
  })).optional()
});

const TypeTextSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional(),
  text: z.string(),
  delay: z.number().optional().default(50)
}).refine(data => data.selector || data.label, {
  message: 'Forneça selector ou label'
});

const ScrollToSchema = z.object({
  selector: z.string().optional(),
  position: z.object({
    x: z.number().optional(),
    y: z.number().optional()
  }).optional()
});

// New schemas for efficiency tools
const GetPageInfoSchema = z.object({
  includeForms: z.boolean().optional().default(true),
  includeButtons: z.boolean().optional().default(true),
  includeLinks: z.boolean().optional().default(true),
  includeInputs: z.boolean().optional().default(true),
  includeClickable: z.boolean().optional().default(true),
  maxElements: z.number().optional().default(100)
});

const BatchActionsSchema = z.object({
  actions: z.array(z.object({
    type: z.string(),
    data: z.record(z.any()).optional()
  })).min(1).max(20),
  stopOnError: z.boolean().optional().default(true)
});

const SmartWaitSchema = z.object({
  conditions: z.array(z.object({
    type: z.enum(['element', 'text', 'url_contains', 'url_equals', 'url_matches', 'network_idle', 'no_loading_spinner', 'element_hidden', 'element_enabled', 'document_ready', 'dom_stable', 'element_count', 'attribute_equals', 'element_text']),
    selector: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    pattern: z.string().optional(),
    duration: z.number().optional(),
    count: z.number().optional(),
    operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']).optional(),
    attribute: z.string().optional(),
    exact: z.boolean().optional(),
    state: z.string().optional()
  })).min(1),
  logic: z.enum(['all', 'any']).optional().default('all'),
  timeout: z.number().optional().default(10000),
  pollInterval: z.number().optional().default(100)
});

const GetAccessibilityTreeSchema = z.object({
  maxDepth: z.number().optional().default(5),
  roles: z.array(z.string()).optional(),
  root: z.string().optional()
});

const FindByRoleSchema = z.object({
  role: z.string(),
  name: z.string().optional()
});

const HighlightElementSchema = z.object({
  selector: z.string(),
  color: z.string().optional().default('red'),
  duration: z.number().optional().default(2000)
});

const RetryActionSchema = z.object({
  action: z.object({
    type: z.string(),
    data: z.record(z.any()).optional()
  }),
  maxAttempts: z.number().optional().default(3),
  delayMs: z.number().optional().default(1000),
  backoff: z.boolean().optional().default(false)
});

const GetElementCenterSchema = z.object({
  selector: z.string()
});

const PageReadySchema = z.object({
  timeout: z.number().optional().default(30000),
  checkNetwork: z.boolean().optional().default(true),
  checkSpinners: z.boolean().optional().default(true),
  stabilityDuration: z.number().optional().default(500)
});

// Gera um ID de sessão único para esta instância do MCP
const instanceSessionId = `mcp_${randomUUID().slice(0, 8)}`;

// Inicializa servidor com o ID da instância
const bridgeServer = new BridgeServer(3002, instanceSessionId);
const mcpServer = new McpServer({
  name: 'universal-browser-mcp',
  version: '2.1.0' // Atualizado para suportar múltiplos clientes
});

console.error(`[MCP] Instance session ID: ${instanceSessionId}`);

// ==================== TOOLS DE SESSÃO ====================

// Session ID fixo para reutilização - uma sessão por instância MCP
const FIXED_SESSION_ID = `session_${instanceSessionId.replace('mcp_', '')}`;

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
  async ({ url }) => {
    // Usa sessionId FIXO para reutilizar a mesma janela
    const sessionId = FIXED_SESSION_ID;

    // Se já tem sessão ativa e conectada, reutiliza
    if (bridgeServer.getCurrentSession() === sessionId && bridgeServer.isSessionConnected(sessionId)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            sessionId,
            reused: true,
            message: 'Reusing existing automation session.',
            tip: 'Use navigate_to to go to a different URL.'
          }, null, 2)
        }]
      };
    }

    // Define a sessão atual
    bridgeServer.setCurrentSession(sessionId);

    // Verifica se o background está conectado
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
      // Timeout curto - se não responder em 5s, retorna erro
      const result = await Promise.race([
        bridgeServer.createSessionViaBackground(sessionId, url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]) as { success?: boolean; error?: string; windowId?: number; activeTabId?: number; message?: string };

      // Se a sessão já existe, é sucesso
      if (result?.message?.includes('already exists') || result?.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sessionId,
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
      // Timeout não é necessariamente erro - janela pode ter sido criada
      if (errorMsg === 'Timeout') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sessionId,
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
  'Fecha a sessão de automação atual e a janela dedicada.',
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();

    if (!sessionId) {
      return {
        content: [{
          type: 'text',
          text: 'Nenhuma sessão ativa para fechar.'
        }]
      };
    }

    try {
      // Envia comando para fechar (se houver conexão)
      if (bridgeServer.isSessionConnected(sessionId)) {
        // Podemos enviar uma mensagem especial para fechar
      }

      // Limpa a sessão do bridge
      bridgeServer.setCurrentSession('');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            closedSession: sessionId,
            message: 'Sessão encerrada. Você pode criar uma nova com create_automation_session.'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Erro ao fechar sessão: ${(error as Error).message}`
        }]
      };
    }
  }
);

mcpServer.tool(
  'get_automation_status',
  'Retorna o status da sessão de automação atual e todas as sessões conectadas.',
  {},
  async () => {
    const currentSession = bridgeServer.getCurrentSession();
    const connectedSessions = bridgeServer.getConnectedSessions();
    const sessionsInfo = bridgeServer.getSessionsInfo();
    const backgroundConnected = bridgeServer.isBackgroundConnected();
    const isServerMode = bridgeServer.isServer();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          instanceId: instanceSessionId,
          mode: isServerMode ? 'server' : 'client',
          currentSession,
          isConnected: currentSession ? bridgeServer.isSessionConnected(currentSession) : false,
          backgroundConnected,
          totalConnections: bridgeServer.getConnectionCount(),
          mcpClientsConnected: isServerMode ? bridgeServer.getMcpClientCount() : 0,
          connectedSessions,
          sessionsInfo,
          message: !backgroundConnected
            ? 'Extensão não conectada. Abra o Chrome e verifique a extensão Universal Browser MCP.'
            : currentSession
              ? (bridgeServer.isSessionConnected(currentSession)
                ? `Sessão ativa e conectada! (modo: ${isServerMode ? 'servidor' : 'cliente'})`
                : 'Sessão configurada mas aguardando conexão do browser')
              : 'Extensão conectada. Use create_automation_session para começar.'
        }, null, 2)
      }]
    };
  }
);

// ==================== TOOLS DE TABS (HANDLES) ====================

mcpServer.tool(
  'open_new_tab',
  `Abre uma nova aba na sessão de automação.

ÚTIL PARA:
- Abrir múltiplas páginas simultaneamente
- Comparar conteúdos
- Navegar em links que abrem em nova aba

EXEMPLO:
{ url: "https://github.com", switchTo: true }`,
  {
    url: z.string().optional().describe('URL para abrir na nova aba (padrão: about:blank)'),
    switchTo: z.boolean().optional().describe('Mudar para a nova aba após criar (padrão: true)')
  },
  async ({ url, switchTo }) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('open_new_tab_command', {
        sessionId,
        url,
        switchTo: switchTo !== false
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_tab_handles',
  `Retorna todas as abas abertas na sessão de automação.

RETORNA:
- Lista de abas com tabId, url, title
- Qual aba está ativa
- Total de abas

ÚTIL PARA:
- Ver quantas abas estão abertas
- Obter IDs das abas para switch_to_tab
- Verificar URLs de cada aba`,
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_tab_handles_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'switch_to_tab',
  `Muda para uma aba específica na sessão.

PARÂMETROS:
- tabId: ID da aba (obtido via get_tab_handles)

EXEMPLO:
{ tabId: 12345 }`,
  {
    tabId: z.number().describe('ID da aba para mudar (obtido via get_tab_handles)')
  },
  async ({ tabId }) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('switch_to_tab_command', { sessionId, tabId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'close_tab',
  `Fecha uma aba específica na sessão.

NOTA: Não é possível fechar a última aba. Use close_automation_session para isso.

EXEMPLO:
{ tabId: 12345 }`,
  {
    tabId: z.number().describe('ID da aba para fechar (obtido via get_tab_handles)')
  },
  async ({ tabId }) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('close_tab_command', { sessionId, tabId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_current_tab',
  'Retorna informações da aba ativa atual.',
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_current_tab_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

// ==================== TOOLS DE NAVEGAÇÃO ====================

mcpServer.tool(
  'navigate_to',
  `Navigate to a URL in the automation window. Returns immediately.

INPUT:
- url: Full URL (e.g., "https://google.com")

WORKFLOW: navigate_to -> wait_for_element -> get_page_info`,
  { url: z.string().describe('Full URL to navigate to') },
  async ({ url }) => {
    NavigateToSchema.parse({ url });

    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Error: No session. Use create_automation_session first.' }] };
    }

    try {
      // 3 second timeout - navigation should be instant
      await Promise.race([
        bridgeServer.sendCommandToBackground('navigate_command', { sessionId, url }, 3000),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      return { content: [{ type: 'text', text: `Navigating to: ${url}` }] };
    } catch {
      // Even on timeout, navigation likely started
      return { content: [{ type: 'text', text: `Navigation started: ${url}` }] };
    }
  }
);

mcpServer.tool(
  'go_back',
  'Volta para a página anterior no histórico do browser.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      await bridgeServer.sendAndWait({ type: 'go_back', data: {} }, 5000);
    } catch { /* ignore timeout */ }
    return { content: [{ type: 'text', text: 'Voltando para página anterior...' }] };
  }
);

mcpServer.tool(
  'go_forward',
  'Avança para a próxima página no histórico do browser.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      await bridgeServer.sendAndWait({ type: 'go_forward', data: {} }, 5000);
    } catch { /* ignore timeout */ }
    return { content: [{ type: 'text', text: 'Avançando para próxima página...' }] };
  }
);

mcpServer.tool(
  'refresh',
  'Recarrega a página atual.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      await bridgeServer.sendAndWait({ type: 'refresh', data: {} }, 5000);
    } catch { /* ignore timeout */ }
    return { content: [{ type: 'text', text: 'Recarregando página...' }] };
  }
);

mcpServer.tool(
  'get_current_url',
  'Retorna a URL atual da página na sessão de automação.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_current_url', data: {} }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
    }
  }
);

// ==================== TOOLS DE INFORMAÇÃO DA PÁGINA ====================

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

// ==================== TOOLS DE INTERAÇÃO ====================

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
  async (params) => {
    FillFieldSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'fill_field', data: params }, 10000);
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
  async ({ fields }) => {
    FillFormSchema.parse({ fields });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'fill_form', data: { fields } }, 15000);
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
  async (params) => {
    ClickElementSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'click_element', data: params }, 10000);
      return { content: [{ type: 'text', text: `Clicked: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
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
  async (params) => {
    SelectOptionSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'select_option', data: params }, 10000);
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
  async (params) => {
    TypeTextSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'type_text', data: params }, 30000);
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
  async ({ selector }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'hover_element', data: { selector } }, 10000);
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
  async ({ selector, x, y }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    const data = selector ? { selector } : { position: { x, y } };

    try {
      const result = await bridgeServer.sendAndWait({ type: 'scroll_to', data }, 5000);
      return { content: [{ type: 'text', text: `Scroll realizado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro no scroll: ${(error as Error).message}` }] };
    }
  }
);

// ==================== TOOLS DE ESPERA ====================

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
  async ({ selector, timeout }) => {
    // Cap at 30s to prevent long blocks
    const effectiveTimeout = Math.min(timeout || 10000, 30000);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait(
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
  'Aguarda até que um texto específico apareça na página.',
  {
    text: z.string().describe('Texto a aguardar'),
    selector: z.string().optional().describe('Seletor do container (opcional)'),
    timeout: z.number().optional().describe('Timeout em ms (padrão: 10000, máximo: 60000)')
  },
  async ({ text, selector, timeout }) => {
    const effectiveTimeout = Math.min(timeout || 10000, 60000);
    WaitForTextSchema.parse({ text, selector, timeout: effectiveTimeout });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa. Use create_automation_session primeiro.' }] };
    }

    try {
      const bridgeTimeout = effectiveTimeout + 3000;

      const result = await bridgeServer.sendAndWait(
        { type: 'wait_for_text', data: { text, selector, timeout: effectiveTimeout } },
        bridgeTimeout
      );
      return { content: [{ type: 'text', text: `Texto encontrado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
        return {
          content: [{
            type: 'text',
            text: `Timeout aguardando texto "${text}" (${effectiveTimeout}ms). Verifique se o texto existe na página.`
          }]
        };
      }
      return { content: [{ type: 'text', text: `Erro: ${errorMsg}` }] };
    }
  }
);

// ==================== TOOLS DE EXTRAÇÃO ====================

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

// ==================== TOOLS DE DIALOG ====================

mcpServer.tool(
  'get_last_dialog',
  'Retorna o último dialog (alert/confirm/prompt) que apareceu na página. Útil para verificar mensagens de alerta.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_last_dialog', data: {} }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_dialog_queue',
  'Retorna todos os dialogs (alert/confirm/prompt) que apareceram desde o último clear. Útil para ver histórico de alertas.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_dialog_queue', data: {} }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'clear_dialog_queue',
  'Limpa a fila de dialogs capturados.',
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'clear_dialog_queue', data: {} }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'set_dialog_auto_accept',
  'Configura se dialogs (alert/confirm/prompt) devem ser aceitos automaticamente. Por padrão está habilitado para automação.',
  {
    enabled: z.boolean().describe('true para aceitar automaticamente, false para bloquear')
  },
  async ({ enabled }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'set_dialog_auto_accept', data: { enabled } }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

// ==================== NOVAS TOOLS ====================

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
  async ({ key, selector, modifiers }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'press_key', data: { key, selector, modifiers } }, 5000);
      return { content: [{ type: 'text', text: `Tecla pressionada: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao pressionar tecla: ${(error as Error).message}` }] };
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
  async ({ selector }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_element_info', data: { selector } }, 10000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
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
  async (params) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'double_click', data: params }, 10000);
      return { content: [{ type: 'text', text: `Clique duplo: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'focus_element',
  `Foca em um elemento da página. Útil antes de usar press_key.`,
  {
    selector: z.string().describe('Seletor CSS do elemento')
  },
  async ({ selector }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'focus_element', data: { selector } }, 5000);
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
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_active_element', data: {} }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
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
  async ({ savePath, format, quality }) => {
    if (!bridgeServer.isBackgroundConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Extensão não conectada.' }] };
    }

    try {
      const sessionId = bridgeServer.getCurrentSession();
      const result = await bridgeServer.sendCommandToBackground('take_screenshot_command', {
        sessionId,
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

// ==================== TOOL DE SCRIPT ====================

mcpServer.tool(
  'execute_script',
  `Executa JavaScript customizado na página. PODEROSO para casos complexos.

QUANDO USAR:
- Campos com Lexical/Draft.js/Slate (editores rich text)
- Interações complexas que outras tools não conseguem
- Manipular elementos Shadow DOM
- Disparar eventos customizados

EXEMPLOS:

1. Inserir texto em campo Lexical (WhatsApp):
{
  script: \`
    const editor = document.querySelector('[contenteditable="true"][data-tab="10"]');
    editor.focus();
    document.execCommand('insertText', false, 'Minha mensagem');
  \`
}

2. Clicar em botão de enviar:
{
  script: \`
    const btn = document.querySelector('[data-icon="send"]');
    btn?.click();
  \`
}

3. Retornar dados:
{
  script: \`
    return document.querySelectorAll('.message').length;
  \`
}

RETORNA: O valor retornado pelo script (ou undefined se não houver return).
CUIDADO: Scripts malformados podem quebrar a página.`,
  {
    script: z.string().describe('Código JavaScript a executar na página'),
    args: z.record(z.any()).optional().describe('Argumentos para passar ao script (acessíveis via args)')
  },
  async ({ script, args }) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'execute_script', data: { script, args } }, 30000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao executar script: ${(error as Error).message}` }] };
    }
  }
);

// ==================== TOOL DE STATUS ====================

mcpServer.tool(
  'get_connection_status',
  'Verifica o status da conexão com o browser e a sessão de automação atual.',
  {},
  async () => {
    const currentSession = bridgeServer.getCurrentSession();
    const isConnected = bridgeServer.isConnected();
    const connectedSessions = bridgeServer.getConnectedSessions();
    const isServerMode = bridgeServer.isServer();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          instanceId: instanceSessionId,
          mode: isServerMode ? 'server' : 'client',
          currentSession,
          isConnected,
          totalConnections: bridgeServer.getConnectionCount(),
          connectedSessions,
          message: isConnected
            ? `Conectado à sessão ${currentSession}. Pronto para automação! (modo: ${isServerMode ? 'servidor' : 'cliente'})`
            : currentSession
            ? `Sessão ${currentSession} configurada mas aguardando conexão do browser.`
            : 'Nenhuma sessão ativa. Use create_automation_session para começar.'
        }, null, 2)
      }]
    };
  }
);

// ==================== ADVANCED DEBUGGING TOOLS ====================

mcpServer.tool(
  'enable_network_capture',
  `Habilita captura de TODAS as requisições HTTP/HTTPS da página.

CAPTURA:
- URLs, métodos, headers
- Status codes, response headers
- Tempo de resposta, tamanho
- Tipo de recurso (XHR, Fetch, Script, etc.)

QUANDO USAR:
- Debug de APIs
- Verificar se requests estão sendo feitas
- Analisar headers de autenticação
- Monitorar performance de rede

IMPORTANTE: Precisa recarregar a página após habilitar para capturar requests iniciais.`,
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('enable_network_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_network_logs',
  `Retorna logs de requisições HTTP capturadas.

RETORNA:
- url, method, status
- headers (request e response)
- timing, size
- resourceType (XHR, Fetch, Document, etc.)

FILTROS DISPONÍVEIS:
- urlFilter: Filtra por URL (substring)
- method: GET, POST, PUT, etc.
- status: 200, 404, 500, etc.
- type: XHR, Fetch, Document, etc.
- limit: Máximo de logs (default: 100)`,
  {
    urlFilter: z.string().optional().describe('Filtra requests que contêm esta string na URL'),
    method: z.string().optional().describe('Filtra por método HTTP (GET, POST, etc.)'),
    status: z.number().optional().describe('Filtra por status code'),
    type: z.string().optional().describe('Filtra por tipo (XHR, Fetch, Document, etc.)'),
    limit: z.number().optional().describe('Máximo de logs a retornar (default: 100)')
  },
  async (params) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_network_logs_command', {
        sessionId,
        options: params
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'enable_console_capture',
  `Habilita captura de TODOS os logs do console da página.

CAPTURA:
- console.log, console.warn, console.error
- console.info, console.debug
- Exceções não tratadas (uncaught errors)
- Logs do navegador

QUANDO USAR:
- Debug de erros JavaScript
- Monitorar logs da aplicação
- Capturar stack traces
- Verificar mensagens de warning`,
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('enable_console_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_console_logs',
  `Retorna logs do console capturados.

RETORNA:
- level: log, warn, error, info, debug
- text: Conteúdo da mensagem
- timestamp: Quando ocorreu
- stackTrace: Stack trace (para erros)

FILTROS:
- level: Filtra por nível (log, warn, error, etc.)
- textFilter: Filtra por texto (substring)
- limit: Máximo de logs`,
  {
    level: z.string().optional().describe('Filtra por nível (log, warn, error, info, debug)'),
    textFilter: z.string().optional().describe('Filtra logs que contêm este texto'),
    limit: z.number().optional().describe('Máximo de logs a retornar (default: 100)')
  },
  async (params) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_console_logs_command', {
        sessionId,
        options: params
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'enable_websocket_capture',
  `Habilita captura de frames WebSocket.

CAPTURA:
- Conexões WebSocket criadas
- Frames enviados e recebidos
- Fechamento de conexões

QUANDO USAR:
- Debug de aplicações real-time
- Monitorar chat/messaging
- Analisar protocolos WebSocket
- Debug de Socket.IO, SignalR, etc.`,
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('enable_websocket_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_websocket_frames',
  `Retorna frames WebSocket capturados.

RETORNA:
- type: created, frame, closed
- direction: sent, received
- payloadData: Conteúdo do frame
- timestamp: Quando ocorreu

FILTROS:
- urlFilter: Filtra por URL do WebSocket
- direction: sent ou received
- limit: Máximo de frames`,
  {
    urlFilter: z.string().optional().describe('Filtra por URL do WebSocket'),
    direction: z.enum(['sent', 'received']).optional().describe('Filtra por direção'),
    limit: z.number().optional().describe('Máximo de frames a retornar (default: 100)')
  },
  async (params) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_websocket_frames_command', {
        sessionId,
        options: params
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_performance_metrics',
  `Retorna métricas de performance da página.

MÉTRICAS INCLUÍDAS:
- JSHeapUsedSize, JSHeapTotalSize (memória JS)
- Documents, Frames, Nodes (DOM)
- LayoutCount, RecalcStyleCount (renderização)
- TaskDuration (tempo de CPU)

QUANDO USAR:
- Analisar uso de memória
- Detectar memory leaks
- Medir performance de renderização`,
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_performance_metrics_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'evaluate_in_page',
  `Executa JavaScript no contexto da página via DevTools Protocol.

MAIS PODEROSO que execute_script porque:
- Acessa APIs privilegiadas
- Pode retornar objetos complexos
- Funciona mesmo com CSP restritivo
- Acessa workers e iframes

EXEMPLOS:
- "window.performance.timing"
- "localStorage.getItem('token')"
- "Array.from(document.cookies)"

RETORNA: Resultado da expressão JavaScript.`,
  {
    expression: z.string().describe('Expressão JavaScript a executar'),
    awaitPromise: z.boolean().optional().describe('Aguardar se for Promise (default: true)'),
    returnByValue: z.boolean().optional().describe('Retornar valor serializado (default: true)')
  },
  async ({ expression, awaitPromise, returnByValue }) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('evaluate_command', {
        sessionId,
        expression,
        options: { awaitPromise, returnByValue }
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'clear_captured_logs',
  `Limpa logs capturados para liberar memória.

TIPOS:
- all: Limpa tudo
- network: Só logs de rede
- console: Só logs do console
- websocket: Só frames WebSocket`,
  {
    logType: z.enum(['all', 'network', 'console', 'websocket']).optional().describe('Tipo de log a limpar (default: all)')
  },
  async ({ logType }) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('clear_logs_command', {
        sessionId,
        type: logType || 'all'
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'get_debugger_status',
  `Retorna status do debugger e contagem de logs capturados.

RETORNA:
- attached: Se o debugger está anexado
- networkEnabled, consoleEnabled, wsEnabled
- Contagem de logs de cada tipo`,
  {},
  async () => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('get_debugger_status_command', { sessionId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'set_request_interception',
  `Habilita interceptação de requests para análise detalhada.

PERMITE:
- Ver body de requests/responses
- Modificar headers
- Bloquear requests
- Redirect URLs

PATTERNS:
- "*" - Todas as URLs
- "*.api.com/*" - Domínio específico
- "*/api/*" - Path específico

CUIDADO: Pode afetar funcionamento da página.`,
  {
    enabled: z.boolean().optional().describe('Habilitar ou desabilitar (default: true)'),
    patterns: z.array(z.object({
      urlPattern: z.string()
    })).optional().describe('Padrões de URL para interceptar')
  },
  async ({ enabled, patterns }) => {
    const sessionId = bridgeServer.getCurrentSession();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendCommandToBackground('set_request_interception_command', {
        sessionId,
        enabled: enabled !== false,
        patterns
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

// ==================== NEW EFFICIENCY TOOLS ====================

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
  async (params) => {
    BatchActionsSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      // Cap at 60s max to prevent infinite blocking
      const result = await bridgeServer.sendAndWait({ type: 'batch_actions', data: params }, 60000);
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
  async (params) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_accessibility_tree', data: params }, 15000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
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
  async (params) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const effectiveTimeout = Math.min(params.timeout || 10000, 60000);
      const result = await bridgeServer.sendAndWait(
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
  async (params) => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const effectiveTimeout = Math.min(params.timeout || 30000, 60000);
      const result = await bridgeServer.sendAndWait(
        { type: 'page_ready', data: { ...params, timeout: effectiveTimeout } },
        effectiveTimeout + 5000
      );
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
  async (params) => {
    FindByRoleSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'find_by_role', data: params }, 10000);
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
  async (params) => {
    HighlightElementSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait(
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
  async (params) => {
    RetryActionSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const maxTime = (params.maxAttempts || 3) * (params.delayMs || 1000) * (params.backoff ? 4 : 1) + 30000;
      const result = await bridgeServer.sendAndWait({ type: 'retry_action', data: params }, maxTime);
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
  async ({ selector }) => {
    GetElementCenterSchema.parse({ selector });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Error: No active automation session.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_element_center', data: { selector } }, 5000);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
    }
  }
);

// ==================== RESOURCES ====================

mcpServer.resource(
  'browser://instrucoes',
  'Instruções de uso do Universal Browser MCP',
  async () => ({
    contents: [{
      uri: 'browser://instrucoes',
      mimeType: 'text/markdown',
      text: `# Universal Browser MCP - Instruções (v2.0)

## Novidades da v2.0 - Sessões Isoladas

Agora o MCP usa **janelas dedicadas** para automação, permitindo:
- Navegar normalmente nas suas abas sem interferência
- Múltiplos Claude Code rodando ao mesmo tempo
- Isolamento completo entre sessões

## Fluxo Recomendado

1. **Crie uma sessão**: \`create_automation_session\` - Abre janela dedicada
2. **Entenda a página**: \`get_page_info\` para ver a estrutura
3. **Interaja**: \`fill_field\`, \`click_element\`, etc.
4. **Aguarde**: \`wait_for_element\` após cliques que causam navegação
5. **Extraia**: \`extract_table\`, \`extract_text\` para obter dados
6. **Feche**: \`close_automation_session\` quando terminar

## Dicas

- **SEMPRE** comece com \`create_automation_session\`
- Use \`get_automation_status\` para verificar o estado
- A janela de automação tem um ícone 🤖 no canto
- Você pode navegar nas suas abas normais sem problema

## Tools de Sessão
- create_automation_session: Cria janela dedicada
- close_automation_session: Fecha a sessão
- get_automation_status: Status completo

## Tools de Navegação
- navigate_to, go_back, go_forward, refresh, get_current_url

## Tools de Informação
- get_page_info, get_page_title, get_page_text

## Tools de Interação
- fill_field, fill_form, click_element, select_option, type_text, hover_element, scroll_to

## Tools de Espera
- wait_for_element, wait_for_text

## Tools de Extração
- extract_text, extract_table, extract_links, extract_form_data
`
    }]
  })
);

// ==================== INICIALIZAÇÃO ====================

const HTTP_PORT = 8080;

// Map para gerenciar transportes SSE ativos (sessionId -> transport)
const activeTransports = new Map<string, SSEServerTransport>();
const clientIdToSessionId = new Map<string, string>(); // clientId -> sessionId para logging

async function main() {
  console.log('[MCP] Starting Universal Browser MCP Server v2.1 (SSE Mode)...');
  console.log(`[MCP] Instance ID: ${instanceSessionId}`);

  // Inicia o WebSocket bridge para a extensão do browser
  await bridgeServer.start();

  const mode = bridgeServer.isServer() ? 'SERVER' : 'CLIENT';
  console.log(`[MCP] WebSocket bridge running in ${mode} mode on port 3002`);

  // Cria servidor HTTP para SSE
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);

    // Endpoint SSE - cliente se conecta aqui para receber eventos
    if (url.pathname === '/sse' && req.method === 'GET') {
      console.log('[MCP] New SSE client connecting...');

      const transport = new SSEServerTransport('/messages', res);

      // Conecta o MCP server ao transporte (isso chama transport.start() internamente)
      await mcpServer.connect(transport);

      // Após o connect, o transport tem seu sessionId gerado
      const transportSessionId = transport.sessionId;
      activeTransports.set(transportSessionId, transport);

      console.log(`[MCP] SSE client connected: ${transportSessionId}`);

      // Cleanup quando o cliente desconecta
      res.on('close', () => {
        console.log(`[MCP] SSE client disconnected: ${transportSessionId}`);
        activeTransports.delete(transportSessionId);
      });

      return;
    }

    // Endpoint para receber mensagens dos clientes
    if (url.pathname === '/messages' && req.method === 'POST') {
      // Extrai o sessionId da query string (enviado pelo cliente SSE)
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
        return;
      }

      const transport = activeTransports.get(sessionId);

      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No transport found for sessionId: ${sessionId}` }));
        return;
      }

      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          await transport.handlePostMessage(req, res, body);
        } catch (error) {
          console.error(`[MCP] Error handling message for session ${sessionId}:`, error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        }
      });

      return;
    }

    // Health check endpoint
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        instanceId: instanceSessionId,
        bridgeMode: mode,
        activeClients: activeTransports.size,
        backgroundConnected: bridgeServer.isBackgroundConnected()
      }));
      return;
    }

    // Info endpoint
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'Universal Browser MCP Server',
        version: '2.1.0',
        transport: 'SSE',
        endpoints: {
          sse: '/sse',
          messages: '/messages',
          health: '/health'
        },
        usage: {
          connect: `GET http://localhost:${HTTP_PORT}/sse`,
          sendMessage: `POST http://localhost:${HTTP_PORT}/messages`
        }
      }));
      return;
    }

    // 404 para outras rotas
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[MCP] ERROR: Port ${HTTP_PORT} already in use!`);
      console.error('[MCP] Another instance may be running. Use a different port or stop the other instance.');
      process.exit(1);
    }
    throw error;
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(`[MCP] HTTP/SSE server listening on http://localhost:${HTTP_PORT}`);
    console.log(`[MCP] Connect via: GET http://localhost:${HTTP_PORT}/sse`);
    console.log('[MCP] Server running. Use create_automation_session to start.');
  });

  // Cleanup ao sair
  process.on('SIGINT', () => {
    console.log('[MCP] Shutting down...');
    httpServer.close();
    bridgeServer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[MCP] Shutting down...');
    httpServer.close();
    bridgeServer.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
