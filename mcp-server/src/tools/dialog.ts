/**
 * Dialog handling tools
 * - get_last_dialog
 * - get_dialog_queue
 * - clear_dialog_queue
 * - set_dialog_auto_accept
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';

export function registerDialogTools(mcpServer: McpServer, bridgeServer: BridgeServer) {
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
}
