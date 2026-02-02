/**
 * Session management tools
 * - create_automation_session
 * - close_automation_session
 * - get_automation_status
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';

export function registerSessionTools(
  mcpServer: McpServer,
  bridgeServer: BridgeServer,
  instanceSessionId: string,
  fixedSessionId: string
) {
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
      const sessionId = fixedSessionId;

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

      bridgeServer.setCurrentSession(sessionId);

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
        const result = await Promise.race([
          bridgeServer.createSessionViaBackground(sessionId, url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]) as { success?: boolean; error?: string; windowId?: number; activeTabId?: number; message?: string };

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
}
