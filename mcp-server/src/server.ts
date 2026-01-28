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

mcpServer.tool(
  'create_automation_session',
  `Cria ou reutiliza uma sessão de automação em janela dedicada do Chrome.

IMPORTANTE:
- SEMPRE chame esta tool primeiro antes de qualquer outra operação
- Se já existir uma janela de automação aberta, ela será REUTILIZADA (não cria nova)
- A janela é isolada das suas abas normais

FLUXO TÍPICO:
1. create_automation_session (abre janela)
2. get_page_info (entende a página)
3. fill_field, click_element, etc. (interage)
4. close_automation_session (quando terminar)`,
  {
    url: z.string().url().optional().describe('URL inicial para abrir (padrão: about:blank)')
  },
  async ({ url }) => {
    // Gera um sessionId único para esta sessão
    const sessionId = `session_${randomUUID().slice(0, 8)}`;

    try {
      // Define a sessão atual no bridge
      bridgeServer.setCurrentSession(sessionId);

      // Verifica se o background está conectado
      if (bridgeServer.isBackgroundConnected()) {
        console.error(`[MCP] Creating session via background: ${sessionId}`);

        // Envia comando para o background criar a janela
        const result = await bridgeServer.createSessionViaBackground(sessionId, url);
        console.error(`[MCP] Session created:`, result);

        // Aguarda o content-script conectar
        let attempts = 0;
        const maxAttempts = 20;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (bridgeServer.isSessionConnected(sessionId)) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  sessionId,
                  message: 'Sessão de automação criada! Uma janela dedicada foi aberta.',
                  tip: 'Agora você pode usar as outras tools. Esta janela é isolada das suas abas normais.'
                }, null, 2)
              }]
            };
          }
          attempts++;
        }

        // Sessão criada mas content-script ainda não conectou
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              sessionId,
              message: 'Janela de automação criada! Aguardando conexão...',
              tip: 'A janela foi aberta. Use get_page_info para verificar quando estiver pronto.',
              result
            }, null, 2)
          }]
        };
      } else {
        // Background não conectado - instruções manuais
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              sessionId,
              message: 'Extensão não conectada ao servidor MCP.',
              instructions: [
                '1. Verifique se a extensão Universal Browser MCP está instalada no Chrome',
                '2. Clique no ícone da extensão para verificar a conexão',
                '3. Se o servidor aparecer como "Conectado", tente novamente',
                '4. Se o servidor aparecer como "Desconectado", aguarde alguns segundos',
                '5. Você pode criar a sessão manualmente pelo popup da extensão'
              ]
            }, null, 2)
          }]
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            sessionId,
            error: (error as Error).message,
            tip: 'Verifique se a extensão está instalada e o Chrome está aberto.'
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

// ==================== TOOLS DE NAVEGAÇÃO ====================

mcpServer.tool(
  'navigate_to',
  'Navega para uma URL específica NA JANELA DE AUTOMAÇÃO. Use para ir a qualquer site.',
  { url: z.string().describe('URL completa para navegar (ex: https://google.com)') },
  async ({ url }) => {
    NavigateToSchema.parse({ url });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa. Use create_automation_session primeiro.' }] };
    }

    await bridgeServer.sendAndWait({ type: 'navigate_to', data: { url } });
    return { content: [{ type: 'text', text: `Navegando para: ${url}` }] };
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

    await bridgeServer.sendAndWait({ type: 'go_back', data: {} });
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

    await bridgeServer.sendAndWait({ type: 'go_forward', data: {} });
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

    await bridgeServer.sendAndWait({ type: 'refresh', data: {} });
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

    const result = await bridgeServer.sendAndWait({ type: 'get_current_url', data: {} });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ==================== TOOLS DE INFORMAÇÃO DA PÁGINA ====================

mcpServer.tool(
  'get_page_info',
  `Retorna estrutura completa da página. SEMPRE use antes de interagir.

RETORNA:
- forms: Formulários com todos os campos
- buttons: Botões e elementos clicáveis
- links: Links da página
- inputs: Campos de entrada
- clickableElements: TODOS elementos clicáveis (incluindo divs com listeners)

ÚTIL PARA:
- Entender a estrutura antes de preencher formulários
- Descobrir seletores de elementos
- Verificar se a página carregou corretamente

DICA: Use clickableElements para encontrar elementos em sites como WhatsApp, Gmail, etc. que usam divs customizados.`,
  {},
  async () => {
    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa. Use create_automation_session primeiro.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'get_page_info', data: {} });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
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

    const result = await bridgeServer.sendAndWait({ type: 'get_page_title', data: {} });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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

    const result = await bridgeServer.sendAndWait({ type: 'get_page_text', data: { selector } });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ==================== TOOLS DE INTERAÇÃO ====================

mcpServer.tool(
  'fill_field',
  'Preenche um campo de formulário. Use label para campos com texto visível ou selector CSS para campos específicos.',
  {
    selector: z.string().optional().describe('Seletor CSS do campo'),
    label: z.string().optional().describe('Texto do label do campo (ex: "Email", "Senha")'),
    value: z.string().describe('Valor a preencher')
  },
  async (params) => {
    FillFieldSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'fill_field', data: params });
      return { content: [{ type: 'text', text: `Campo preenchido: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao preencher campo: ${(error as Error).message}` }] };
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
      const result = await bridgeServer.sendAndWait({ type: 'fill_form', data: { fields } });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao preencher formulário: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'click_element',
  `Clica em um elemento da página (botão, link, div, etc).

COMO USAR:
- Por texto: { text: "Enviar" } - busca em botões, links e elementos clicáveis
- Por seletor: { selector: "#btn-submit" } - mais preciso

DICAS:
- Se o clique não funcionar, use get_element_info para descobrir o seletor correto
- Para elementos em listas (WhatsApp, emails), use seletor com [title] ou [data-testid]
- O clique simula eventos completos (mousedown, mouseup, click)
- Automaticamente encontra o elemento clicável mais próximo

EXEMPLOS:
- Botão: { text: "Confirmar" }
- Link: { text: "Saiba mais" }
- Por seletor: { selector: "[data-testid='send-btn']" }
- Item de lista: { selector: "span[title='Nome do contato']" }`,
  {
    selector: z.string().optional().describe('Seletor CSS do elemento'),
    text: z.string().optional().describe('Texto visível do elemento (ex: "Entrar", "Buscar")'),
    clickParent: z.boolean().optional().describe('Se true (padrão), busca elemento clicável pai')
  },
  async (params) => {
    ClickElementSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'click_element', data: params });
      return { content: [{ type: 'text', text: `Elemento clicado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao clicar: ${(error as Error).message}` }] };
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
      const result = await bridgeServer.sendAndWait({ type: 'select_option', data: params });
      return { content: [{ type: 'text', text: `Opção selecionada: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao selecionar: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'type_text',
  `Digita texto caractere por caractere, simulando digitação real.

DIFERENÇA DO fill_field:
- fill_field: Preenche instantaneamente (mais rápido)
- type_text: Simula digitação humana (mais lento, mas funciona com autocomplete)

QUANDO USAR:
- Campos de busca com autocomplete
- Campos que validam enquanto digita
- Quando fill_field não funcionar

EXEMPLO:
{ label: "Pesquisar", text: "termo de busca", delay: 100 }`,
  {
    selector: z.string().optional().describe('Seletor CSS do campo'),
    label: z.string().optional().describe('Label do campo'),
    text: z.string().describe('Texto a digitar'),
    delay: z.number().optional().describe('Delay entre teclas em ms (padrão: 50)')
  },
  async (params) => {
    TypeTextSchema.parse(params);

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'type_text', data: params }, 60000);
      return { content: [{ type: 'text', text: `Texto digitado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro ao digitar: ${(error as Error).message}` }] };
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
      const result = await bridgeServer.sendAndWait({ type: 'hover_element', data: { selector } });
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
      const result = await bridgeServer.sendAndWait({ type: 'scroll_to', data });
      return { content: [{ type: 'text', text: `Scroll realizado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro no scroll: ${(error as Error).message}` }] };
    }
  }
);

// ==================== TOOLS DE ESPERA ====================

mcpServer.tool(
  'wait_for_element',
  `Aguarda até que um elemento apareça e esteja visível na página.

QUANDO USAR:
- Após click_element que causa navegação ou carregamento
- Aguardar modais abrirem
- Aguardar conteúdo dinâmico carregar
- Antes de interagir com elementos que demoram a aparecer

EXEMPLO:
{ selector: ".modal-content", timeout: 5000 }

DICA: Use após cada ação que cause mudança na página antes de continuar.`,
  {
    selector: z.string().describe('Seletor CSS do elemento'),
    timeout: z.number().optional().describe('Timeout em ms (padrão: 10000)')
  },
  async ({ selector, timeout }) => {
    WaitForElementSchema.parse({ selector, timeout });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait(
        { type: 'wait_for_element', data: { selector, timeout: timeout || 10000 } },
        (timeout || 10000) + 5000
      );
      return { content: [{ type: 'text', text: `Elemento encontrado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'wait_for_text',
  'Aguarda até que um texto específico apareça na página.',
  {
    text: z.string().describe('Texto a aguardar'),
    selector: z.string().optional().describe('Seletor do container (opcional)'),
    timeout: z.number().optional().describe('Timeout em ms (padrão: 10000)')
  },
  async ({ text, selector, timeout }) => {
    WaitForTextSchema.parse({ text, selector, timeout });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait(
        { type: 'wait_for_text', data: { text, selector, timeout: timeout || 10000 } },
        (timeout || 10000) + 5000
      );
      return { content: [{ type: 'text', text: `Texto encontrado: ${JSON.stringify(result)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

// ==================== TOOLS DE EXTRAÇÃO ====================

mcpServer.tool(
  'extract_text',
  'Extrai o texto de um elemento específico.',
  {
    selector: z.string().describe('Seletor CSS do elemento')
  },
  async ({ selector }) => {
    ExtractTextSchema.parse({ selector });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'extract_text', data: { selector } });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
    }
  }
);

mcpServer.tool(
  'extract_table',
  'Extrai dados de uma tabela HTML como JSON estruturado.',
  {
    selector: z.string().optional().describe('Seletor CSS da tabela (padrão: primeira tabela)')
  },
  async ({ selector }) => {
    ExtractTableSchema.parse({ selector });

    if (!bridgeServer.isConnected()) {
      return { content: [{ type: 'text', text: 'Erro: Nenhuma sessão de automação ativa.' }] };
    }

    try {
      const result = await bridgeServer.sendAndWait({ type: 'extract_table', data: { selector } });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
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
      const result = await bridgeServer.sendAndWait({ type: 'extract_links', data: { selector, limit } });
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
      const result = await bridgeServer.sendAndWait({ type: 'extract_form_data', data: { selector } });
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
      const result = await bridgeServer.sendAndWait({ type: 'extract_styles', data: params });
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
      const result = await bridgeServer.sendAndWait({ type: 'extract_html', data: params });
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
      const result = await bridgeServer.sendAndWait({ type: 'get_stylesheets', data: {} });
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
      const result = await bridgeServer.sendAndWait({ type: 'get_last_dialog', data: {} });
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
      const result = await bridgeServer.sendAndWait({ type: 'get_dialog_queue', data: {} });
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
      const result = await bridgeServer.sendAndWait({ type: 'clear_dialog_queue', data: {} });
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
      const result = await bridgeServer.sendAndWait({ type: 'set_dialog_auto_accept', data: { enabled } });
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
      const result = await bridgeServer.sendAndWait({ type: 'press_key', data: { key, selector, modifiers } });
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
      const result = await bridgeServer.sendAndWait({ type: 'get_element_info', data: { selector } });
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
      const result = await bridgeServer.sendAndWait({ type: 'double_click', data: params });
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
      const result = await bridgeServer.sendAndWait({ type: 'focus_element', data: { selector } });
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
      const result = await bridgeServer.sendAndWait({ type: 'get_active_element', data: {} });
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

// Map para gerenciar transportes SSE ativos
const activeTransports = new Map<string, SSEServerTransport>();

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
      const clientId = randomUUID();
      activeTransports.set(clientId, transport);

      // Conecta o MCP server ao transporte
      await mcpServer.connect(transport);

      console.log(`[MCP] SSE client connected: ${clientId}`);

      // Cleanup quando o cliente desconecta
      res.on('close', () => {
        console.log(`[MCP] SSE client disconnected: ${clientId}`);
        activeTransports.delete(clientId);
      });

      return;
    }

    // Endpoint para receber mensagens dos clientes
    if (url.pathname === '/messages' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        // Encontra o transporte ativo e envia a mensagem
        // O SSEServerTransport espera que as mensagens sejam enviadas via POST
        for (const transport of activeTransports.values()) {
          try {
            await transport.handlePostMessage(req, res, body);
            return;
          } catch {
            // Continua para o próximo
          }
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active transport found' }));
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
