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
import { BridgeServer } from './websocket/bridge-server.js';
import { randomUUID } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// Import tool registration functions
import {
  registerSessionTools,
  registerTabTools,
  registerNavigationTools,
  registerPageInfoTools,
  registerInteractionTools,
  registerWaitTools,
  registerExtractionTools,
  registerDialogTools,
  registerDebuggingTools,
  registerEfficiencyTools
} from './tools/index.js';

// Import resource registration
import { registerResources } from './resources.js';

// ==================== CONFIGURAÇÃO ====================

const HTTP_PORT = 8080;

// Gera um ID de sessão único para esta instância do MCP
const instanceSessionId = `mcp_${randomUUID().slice(0, 8)}`;

// Session ID fixo para reutilização - uma sessão por instância MCP
const FIXED_SESSION_ID = `session_${instanceSessionId.replace('mcp_', '')}`;

// ==================== INICIALIZAÇÃO ====================

// Inicializa servidor com o ID da instância
const bridgeServer = new BridgeServer(3002, instanceSessionId);
const mcpServer = new McpServer({
  name: 'universal-browser-mcp',
  version: '2.1.0'
});

console.error(`[MCP] Instance session ID: ${instanceSessionId}`);

// ==================== REGISTRO DE TOOLS ====================

// Register all tools
registerSessionTools(mcpServer, bridgeServer, instanceSessionId, FIXED_SESSION_ID);
registerTabTools(mcpServer, bridgeServer);
registerNavigationTools(mcpServer, bridgeServer);
registerPageInfoTools(mcpServer, bridgeServer);
registerInteractionTools(mcpServer, bridgeServer);
registerWaitTools(mcpServer, bridgeServer);
registerExtractionTools(mcpServer, bridgeServer);
registerDialogTools(mcpServer, bridgeServer);
registerDebuggingTools(mcpServer, bridgeServer);
registerEfficiencyTools(mcpServer, bridgeServer);

// Register resources
registerResources(mcpServer);

// ==================== SERVIDOR HTTP/SSE ====================

// Map para gerenciar transportes SSE ativos (sessionId -> transport)
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
    console.log('\n[MCP] Shutting down...');
    httpServer.close();
    bridgeServer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[MCP] Shutting down...');
    httpServer.close();
    bridgeServer.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
