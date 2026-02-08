/**
 * Tab management tools (handles)
 * - open_new_tab
 * - get_tab_handles
 * - switch_to_tab
 * - close_tab
 * - get_current_tab
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerTabTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
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
    async ({ url, switchTo }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('open_new_tab_command', {
          sessionId: session.browserSessionId,
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
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_tab_handles_command', { sessionId: session.browserSessionId });
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
    async ({ tabId }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('switch_to_tab_command', { sessionId: session.browserSessionId, tabId });
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
    async ({ tabId }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('close_tab_command', { sessionId: session.browserSessionId, tabId });
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
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendCommandToBackground('get_current_tab_command', { sessionId: session.browserSessionId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Erro: ${(error as Error).message}` }] };
      }
    }
  );
}
