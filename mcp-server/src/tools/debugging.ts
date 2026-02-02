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

export function registerDebuggingTools(mcpServer: McpServer, bridgeServer: BridgeServer) {
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
}
