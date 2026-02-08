#!/usr/bin/env node

/**
 * Universal Browser MCP Server
 * Permite ao Claude controlar qualquer página web via Chrome Extension
 * Suporta múltiplas sessões isoladas para múltiplos clientes MCP
 *
 * Transportes suportados:
 * - Streamable HTTP: POST/GET/DELETE /mcp (moderno)
 * - SSE: GET /sse + POST /messages (compatibilidade com clientes legados)
 * - Porta 8080: Servidor HTTP para clientes MCP
 * - Porta 3002: WebSocket bridge para a extensão do browser
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { BridgeServer } from './websocket/bridge-server.js';
import { SessionManager } from './session-manager.js';
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

// ID for the bridge server instance
const instanceId = `mcp_${randomUUID().slice(0, 8)}`;

// ==================== SHARED STATE ====================

// Shared across all MCP sessions
const bridgeServer = new BridgeServer(3002, instanceId);
const sessionManager = new SessionManager();

// Track active transports: sessionId -> transport
const transports: Record<string, StreamableHTTPServerTransport> = {};
const sseTransports: Record<string, SSEServerTransport> = {};

// ==================== MCP SERVER FACTORY ====================

/**
 * Creates a new McpServer instance with all tools registered.
 * Each client session gets its own McpServer.
 */
function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: 'universal-browser-mcp',
    version: '3.0.0'
  });

  // Register all tools with shared sessionManager
  registerSessionTools(mcpServer, bridgeServer, sessionManager);
  registerTabTools(mcpServer, bridgeServer, sessionManager);
  registerNavigationTools(mcpServer, bridgeServer, sessionManager);
  registerPageInfoTools(mcpServer, bridgeServer, sessionManager);
  registerInteractionTools(mcpServer, bridgeServer, sessionManager);
  registerWaitTools(mcpServer, bridgeServer, sessionManager);
  registerExtractionTools(mcpServer, bridgeServer, sessionManager);
  registerDialogTools(mcpServer, bridgeServer, sessionManager);
  registerDebuggingTools(mcpServer, bridgeServer, sessionManager);
  registerEfficiencyTools(mcpServer, bridgeServer, sessionManager);

  // Register resources
  registerResources(mcpServer);

  return mcpServer;
}

// ==================== HTTP SERVER ====================

async function main() {
  console.log('[MCP] Starting Universal Browser MCP Server v3.0 (Streamable HTTP + SSE)...');
  console.log(`[MCP] Instance ID: ${instanceId}`);

  // Start WebSocket bridge
  await bridgeServer.start();

  const mode = bridgeServer.isServer() ? 'SERVER' : 'CLIENT';
  console.log(`[MCP] WebSocket bridge running in ${mode} mode on port 3002`);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, last-event-id, mcp-protocol-version');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);

    // ==================== MCP ENDPOINT ====================

    if (url.pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // --- POST /mcp ---
      if (req.method === 'POST') {
        // Read request body
        const body = await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          req.on('end', () => resolve(data));
        });

        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        // New session: no session ID header and request is an initialize request
        if (!sessionId && isInitializeRequest(parsedBody)) {
          console.log('[MCP] New client session initializing...');

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          const mcpServer = createMcpServer();

          // Connect the new McpServer to the new transport
          await mcpServer.connect(transport);

          // handleRequest processes the initialize and assigns sessionId
          await transport.handleRequest(req, res, parsedBody);

          // NOW the sessionId is available (set during handleRequest)
          const newSessionId = transport.sessionId;
          if (newSessionId) {
            transports[newSessionId] = transport;
            console.log(`[MCP] Client session created: ${newSessionId}`);

            // Cleanup when transport closes
            transport.onclose = () => {
              console.log(`[MCP] Transport closed for session: ${newSessionId}`);
              delete transports[newSessionId];
              sessionManager.removeSession(newSessionId);
            };
          } else {
            console.error('[MCP] Warning: sessionId not assigned after handleRequest');
          }

          return;
        }

        // Existing session: route to its transport
        if (sessionId && transports[sessionId]) {
          await transports[sessionId].handleRequest(req, res, parsedBody);
          return;
        }

        // Invalid: POST without session ID and not an initialize request
        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Missing mcp-session-id header. Send an initialize request first.' },
            id: null
          }));
          return;
        }

        // Session not found
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: `Session not found: ${sessionId}` },
          id: null
        }));
        return;
      }

      // --- GET /mcp (SSE stream for server-initiated messages) ---
      if (req.method === 'GET') {
        if (!sessionId || !transports[sessionId]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
          return;
        }

        await transports[sessionId].handleRequest(req, res);
        return;
      }

      // --- DELETE /mcp (terminate session) ---
      if (req.method === 'DELETE') {
        if (!sessionId || !transports[sessionId]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        console.log(`[MCP] Client requested session termination: ${sessionId}`);

        const transport = transports[sessionId];
        await transport.close();
        delete transports[sessionId];
        sessionManager.removeSession(sessionId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Unsupported method
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // ==================== SSE ENDPOINTS (legacy compatibility) ====================

    if (url.pathname === '/sse' && req.method === 'GET') {
      console.log('[MCP] New SSE client connecting (legacy transport)...');

      const transport = new SSEServerTransport('/messages', res);
      const mcpServer = createMcpServer();

      await mcpServer.connect(transport);

      const sseSessionId = transport.sessionId;
      sseTransports[sseSessionId] = transport;

      console.log(`[MCP] SSE session created: ${sseSessionId}`);

      transport.onclose = () => {
        console.log(`[MCP] SSE transport closed: ${sseSessionId}`);
        delete sseTransports[sseSessionId];
        sessionManager.removeSession(sseSessionId);
      };

      // Note: mcpServer.connect() already calls transport.start() internally
      return;
    }

    if (url.pathname === '/messages' && req.method === 'POST') {
      const sseSessionId = url.searchParams.get('sessionId');

      if (!sseSessionId || !sseTransports[sseSessionId]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
        return;
      }

      // Read body
      const body = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
      });

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      await sseTransports[sseSessionId].handlePostMessage(req, res, parsedBody);
      return;
    }

    // ==================== HEALTH CHECK ====================

    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transports: ['streamable-http', 'sse'],
        activeSessions: Object.keys(transports).length + Object.keys(sseTransports).length,
        streamableHttpSessions: Object.keys(transports).length,
        sseSessions: Object.keys(sseTransports).length,
        bridgeMode: mode,
        backgroundConnected: bridgeServer.isBackgroundConnected()
      }));
      return;
    }

    // ==================== INFO ENDPOINT ====================

    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'Universal Browser MCP Server',
        version: '3.0.0',
        transports: ['streamable-http', 'sse'],
        endpoints: {
          mcp: '/mcp (Streamable HTTP)',
          sse: '/sse (SSE - legacy)',
          messages: '/messages (SSE messages)',
          health: '/health'
        },
        usage: {
          initialize: `POST http://localhost:${HTTP_PORT}/mcp (with initialize request body)`,
          messages: `POST http://localhost:${HTTP_PORT}/mcp (with mcp-session-id header)`,
          sse: `GET http://localhost:${HTTP_PORT}/mcp (with mcp-session-id header)`,
          terminate: `DELETE http://localhost:${HTTP_PORT}/mcp (with mcp-session-id header)`
        }
      }));
      return;
    }

    // 404 for other routes
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
    console.log(`[MCP] HTTP server listening on http://localhost:${HTTP_PORT}`);
    console.log(`[MCP] Streamable HTTP: POST/GET/DELETE http://localhost:${HTTP_PORT}/mcp`);
    console.log(`[MCP] SSE (legacy):    GET http://localhost:${HTTP_PORT}/sse`);
    console.log('[MCP] Server running. Use create_automation_session to start.');
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[MCP] Shutting down...');

    // Close all active Streamable HTTP transports
    for (const [sid, transport] of Object.entries(transports)) {
      try {
        await transport.close();
        delete transports[sid];
      } catch (err) {
        console.error(`[MCP] Error closing transport ${sid}:`, err);
      }
    }

    // Close all active SSE transports
    for (const [sid, transport] of Object.entries(sseTransports)) {
      try {
        await transport.close();
        delete sseTransports[sid];
      } catch (err) {
        console.error(`[MCP] Error closing SSE transport ${sid}:`, err);
      }
    }

    httpServer.close();
    bridgeServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
