/**
 * Universal Browser MCP - WebSocket Bridge Server
 * Gerencia múltiplas sessões de automação isoladas
 * Suporta conexão de controle do background.js
 *
 * IMPORTANTE: Suporta múltiplas instâncias MCP conectando ao mesmo servidor
 * - Primeira instância: Cria o servidor WebSocket
 * - Instâncias adicionais: Conectam como clientes ao servidor existente
 */

import { WebSocketServer, WebSocket } from 'ws';

export interface BridgeMessage {
  type: string;
  data?: unknown;
  requestId?: string;
  sessionId?: string;
  mcpInstanceId?: string; // ID da instância MCP que enviou/deve receber
  success?: boolean;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  sessionId: string;
  mcpInstanceId: string; // Track which MCP instance made the request
}

interface SessionClient {
  ws: WebSocket;
  sessionId: string;
  url?: string;
  connectedAt: number;
  isBackground?: boolean;
  isMcpClient?: boolean;
  mcpInstanceId?: string;
}

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, SessionClient> = new Map();
  private sessionClients: Map<string, WebSocket> = new Map(); // sessionId -> WebSocket
  private backgroundClient: WebSocket | null = null; // Conexão do background.js
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestCounter = 0;
  private port: number;
  private currentSessionId: string | null = null;

  // Suporte para múltiplas instâncias MCP
  private mcpInstanceId: string;
  private isServerMode: boolean = false;
  private clientWs: WebSocket | null = null; // WebSocket client (quando não é servidor)
  private mcpClients: Map<string, WebSocket> = new Map(); // mcpInstanceId -> WebSocket (quando é servidor)
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  // Cleanup and limits for pending requests
  private cleanupInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly MAX_PENDING_REQUESTS = 50;
  private readonly STALE_REQUEST_TIMEOUT = 60000; // 1 minute (was 2 minutes)
  private readonly PING_INTERVAL = 10000; // 10 seconds (was 15)
  private readonly PONG_TIMEOUT = 5000; // 5 seconds to receive pong (was 10)
  private readonly DEFAULT_COMMAND_TIMEOUT = 15000; // 15 seconds default for background commands

  constructor(port: number = 3002, instanceId?: string) {
    this.port = port;
    this.mcpInstanceId = instanceId || `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Retorna o ID desta instância MCP
   */
  getInstanceId(): string {
    return this.mcpInstanceId;
  }

  /**
   * Define o ID da instância (chamado do server.ts)
   */
  setInstanceId(id: string): void {
    this.mcpInstanceId = id;
  }

  /**
   * Verifica se o background está conectado
   * Em modo cliente, assume conectado se o cliente WebSocket está ativo
   */
  isBackgroundConnected(): boolean {
    if (this.isServerMode) {
      return this.backgroundClient !== null && this.backgroundClient.readyState === WebSocket.OPEN;
    } else {
      // Em modo cliente, verifica se o WebSocket está conectado
      return this.clientWs !== null && this.clientWs.readyState === WebSocket.OPEN;
    }
  }

  /**
   * Envia comando para o background criar uma sessão
   */
  async createSessionViaBackground(sessionId: string, url?: string): Promise<unknown> {
    const requestId = `bg_${++this.requestCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.checkPendingRequestLimit();

      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Timeout waiting for background to create session. Is the Chrome extension running?'));
      }, 10000); // 10 seconds for session creation - should be fast

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        sessionId: '__background__',
        mcpInstanceId: this.mcpInstanceId
      });

      const message = JSON.stringify({
        type: 'create_session_command',
        requestId,
        sessionId: '__background__',
        mcpInstanceId: this.mcpInstanceId,
        data: { sessionId, url: url || 'about:blank' }
      });

      if (this.isServerMode) {
        if (!this.backgroundClient || this.backgroundClient.readyState !== WebSocket.OPEN) {
          this.pendingRequests.delete(requestId);
          clearTimeout(timeoutHandle);
          reject(new Error('Background not connected. Please ensure the Chrome extension is running.'));
          return;
        }
        this.backgroundClient.send(message);
      } else {
        if (!this.clientWs || this.clientWs.readyState !== WebSocket.OPEN) {
          this.pendingRequests.delete(requestId);
          clearTimeout(timeoutHandle);
          reject(new Error('Not connected to bridge server.'));
          return;
        }
        this.clientWs.send(message);
      }
    });
  }

  /**
   * Envia comando genérico para o background
   */
  async sendCommandToBackground(commandType: string, data?: unknown, timeout?: number): Promise<unknown> {
    const requestId = `bg_${++this.requestCounter}_${Date.now()}`;
    const effectiveTimeout = timeout || this.DEFAULT_COMMAND_TIMEOUT;

    return new Promise((resolve, reject) => {
      this.checkPendingRequestLimit();

      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timeout (${effectiveTimeout}ms) waiting for background command: ${commandType}`));
      }, effectiveTimeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        sessionId: '__background__',
        mcpInstanceId: this.mcpInstanceId
      });

      const message = JSON.stringify({
        type: commandType,
        requestId,
        sessionId: '__background__',
        mcpInstanceId: this.mcpInstanceId,
        data
      });

      if (this.isServerMode) {
        if (!this.backgroundClient || this.backgroundClient.readyState !== WebSocket.OPEN) {
          this.pendingRequests.delete(requestId);
          clearTimeout(timeoutHandle);
          reject(new Error('Background not connected. Please ensure the Chrome extension is running.'));
          return;
        }
        this.backgroundClient.send(message);
      } else {
        if (!this.clientWs || this.clientWs.readyState !== WebSocket.OPEN) {
          this.pendingRequests.delete(requestId);
          clearTimeout(timeoutHandle);
          reject(new Error('Not connected to bridge server.'));
          return;
        }
        this.clientWs.send(message);
      }
    });
  }

  /**
   * Define a sessão atual para este MCP server
   */
  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    console.error(`[Bridge] Current session set to: ${sessionId}`);
  }

  /**
   * Retorna a sessão atual
   */
  getCurrentSession(): string | null {
    return this.currentSessionId;
  }

  /**
   * Starts periodic cleanup of stale pending requests
   */
  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [requestId, pending] of this.pendingRequests) {
        // Extract timestamp from requestId (format: bg_X_TIMESTAMP or req_X_TIMESTAMP)
        const parts = requestId.split('_');
        const timestamp = parseInt(parts[parts.length - 1], 10);

        if (!isNaN(timestamp) && now - timestamp > this.STALE_REQUEST_TIMEOUT) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Request ${requestId} cleaned up due to staleness (${Math.round((now - timestamp) / 1000)}s old)`));
          this.pendingRequests.delete(requestId);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.error(`[Bridge] Cleaned up ${cleaned} stale pending requests`);
      }

      // Log pending requests count for debugging
      if (this.pendingRequests.size > 5) {
        console.error(`[Bridge] Warning: ${this.pendingRequests.size} pending requests`);
      }
    }, 15000); // Run every 15 seconds (was 30)
  }

  /**
   * Starts periodic ping to detect dead connections
   */
  private startPingInterval(): void {
    if (this.pingInterval || !this.isServerMode) return;

    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const deadConnections: WebSocket[] = [];

      for (const [ws, client] of this.clients) {
        if (ws.readyState !== WebSocket.OPEN) {
          deadConnections.push(ws);
          continue;
        }

        // Send ping
        try {
          ws.ping();
        } catch (err) {
          console.error(`[Bridge] Ping failed for ${client.sessionId}:`, err);
          deadConnections.push(ws);
        }
      }

      // Clean up dead connections
      for (const ws of deadConnections) {
        const client = this.clients.get(ws);
        if (client) {
          console.error(`[Bridge] Removing dead connection: ${client.sessionId}`);
          if (client.isBackground) {
            this.backgroundClient = null;
            this.cleanupPendingRequestsForSession('__background__');
          } else if (client.isMcpClient && client.mcpInstanceId) {
            this.mcpClients.delete(client.mcpInstanceId);
            this.cleanupPendingRequestsForSession(client.sessionId, client.mcpInstanceId);
          } else {
            this.sessionClients.delete(client.sessionId);
            this.cleanupPendingRequestsForSession(client.sessionId);
          }
          this.clients.delete(ws);
        }
        try {
          ws.terminate();
        } catch {}
      }
    }, this.PING_INTERVAL);
  }

  /**
   * Cleanup pending requests for a disconnected session or client
   * This is CRITICAL to prevent hanging requests when browser disconnects
   */
  private cleanupPendingRequestsForSession(sessionId: string, mcpInstanceId?: string): void {
    let cleaned = 0;

    for (const [requestId, pending] of this.pendingRequests) {
      const shouldClean = pending.sessionId === sessionId ||
        (mcpInstanceId && pending.mcpInstanceId === mcpInstanceId);

      if (shouldClean) {
        clearTimeout(pending.timeout);
        const errorMsg = sessionId === '__background__'
          ? 'Background extension disconnected. Ensure the Chrome extension is running.'
          : `Browser session disconnected. The page may have navigated or closed.`;
        pending.reject(new Error(errorMsg));
        this.pendingRequests.delete(requestId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.error(`[Bridge] Cleaned up ${cleaned} pending requests for session ${sessionId}`);
    }
  }

  /**
   * Check if we can accept new pending requests
   */
  private checkPendingRequestLimit(): void {
    if (this.pendingRequests.size >= this.MAX_PENDING_REQUESTS) {
      // Find and reject oldest request
      let oldestId: string | null = null;
      let oldestTime = Infinity;

      for (const [requestId] of this.pendingRequests) {
        const parts = requestId.split('_');
        const timestamp = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(timestamp) && timestamp < oldestTime) {
          oldestTime = timestamp;
          oldestId = requestId;
        }
      }

      if (oldestId) {
        const pending = this.pendingRequests.get(oldestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Request evicted due to queue limit'));
          this.pendingRequests.delete(oldestId);
          console.error(`[Bridge] Evicted oldest pending request due to limit`);
        }
      }
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          this.isServerMode = true;
          this.startCleanupInterval();
          this.startPingInterval();
          console.error(`[Bridge] WebSocket server running on port ${this.port} (instance: ${this.mcpInstanceId})`);
          resolve();
        });

        this.wss.on('connection', (ws: WebSocket) => {
          console.error('[Bridge] New connection received');

          ws.on('message', (data: Buffer) => {
            try {
              const message: BridgeMessage = JSON.parse(data.toString());
              this.handleMessage(ws, message);
            } catch (error) {
              console.error('[Bridge] Error parsing message:', error);
            }
          });

          ws.on('close', () => {
            const client = this.clients.get(ws);
            if (client) {
              console.error(`[Bridge] Connection closed (session: ${client.sessionId})`);
              if (client.isBackground) {
                this.backgroundClient = null;
                console.error('[Bridge] Background controller disconnected');
                // Cleanup pending requests waiting for background
                this.cleanupPendingRequestsForSession('__background__');
              } else if (client.isMcpClient && client.mcpInstanceId) {
                this.mcpClients.delete(client.mcpInstanceId);
                console.error(`[Bridge] MCP client disconnected: ${client.mcpInstanceId}`);
                // Cleanup pending requests for this MCP client
                this.cleanupPendingRequestsForSession(client.sessionId, client.mcpInstanceId);
              } else {
                this.sessionClients.delete(client.sessionId);
                // Cleanup pending requests for this session
                this.cleanupPendingRequestsForSession(client.sessionId);
              }
              this.clients.delete(ws);
            }
          });

          ws.on('error', (error) => {
            console.error('[Bridge] WebSocket error:', error);
            const client = this.clients.get(ws);
            if (client) {
              if (client.isBackground) {
                this.backgroundClient = null;
              } else if (client.isMcpClient && client.mcpInstanceId) {
                this.mcpClients.delete(client.mcpInstanceId);
              } else {
                this.sessionClients.delete(client.sessionId);
              }
            }
            this.clients.delete(ws);
          });
        });

        this.wss.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`[Bridge] Port ${this.port} already in use - connecting as client to existing server`);
            this.isServerMode = false;
            this.wss = null;
            // Conecta como cliente ao servidor existente
            this.connectAsClient()
              .then(() => resolve())
              .catch(reject);
          } else {
            console.error('[Bridge] Server error:', error);
            reject(error);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Conecta como cliente a um servidor WebSocket existente
   */
  private connectAsClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:${this.port}`;
      console.error(`[Bridge] Connecting as client to ${wsUrl}...`);

      try {
        this.clientWs = new WebSocket(wsUrl);

        this.clientWs.on('open', () => {
          console.error(`[Bridge] Connected as client (instance: ${this.mcpInstanceId})`);
          this.reconnectAttempts = 0;
          this.startCleanupInterval();

          // Registra esta instância MCP no servidor
          this.clientWs!.send(JSON.stringify({
            type: 'mcp_client_ready',
            mcpInstanceId: this.mcpInstanceId,
            data: { timestamp: Date.now() }
          }));

          resolve();
        });

        this.clientWs.on('message', (data: Buffer) => {
          try {
            const message: BridgeMessage = JSON.parse(data.toString());
            this.handleClientMessage(message);
          } catch (error) {
            console.error('[Bridge] Error parsing client message:', error);
          }
        });

        this.clientWs.on('close', () => {
          console.error('[Bridge] Client connection closed');
          this.clientWs = null;
          this.scheduleReconnect();
        });

        this.clientWs.on('error', (error) => {
          console.error('[Bridge] Client connection error:', error);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Agenda reconexão como cliente
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Bridge] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    console.error(`[Bridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connectAsClient().catch(err => {
        console.error('[Bridge] Reconnection failed:', err);
      });
    }, delay);
  }

  /**
   * Processa mensagens quando operando como cliente
   */
  private handleClientMessage(message: BridgeMessage): void {
    const { type, requestId, mcpInstanceId, success, data, error } = message;

    // Ignora mensagens que não são para esta instância
    if (mcpInstanceId && mcpInstanceId !== this.mcpInstanceId) {
      return;
    }

    // Resposta a um request pendente
    if (type === 'response' && requestId) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);

        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error || 'Unknown error'));
        }
      }
      return;
    }

    // Confirmação de registro
    if (type === 'mcp_client_registered') {
      console.error(`[Bridge] Registered with server as ${this.mcpInstanceId}`);
      return;
    }

    // Status do background
    if (type === 'background_status') {
      console.error('[Bridge] Background status:', data);
      return;
    }
  }

  private handleMessage(ws: WebSocket, message: BridgeMessage): void {
    const { type, requestId, sessionId, mcpInstanceId, success, data, error } = message;

    // Outro cliente MCP se registrando
    if (type === 'mcp_client_ready' && mcpInstanceId) {
      console.error(`[Bridge] MCP client connected: ${mcpInstanceId}`);

      const clientInfo: SessionClient = {
        ws,
        sessionId: `__mcp_${mcpInstanceId}__`,
        connectedAt: Date.now(),
        isMcpClient: true,
        mcpInstanceId
      };

      this.clients.set(ws, clientInfo);
      this.mcpClients.set(mcpInstanceId, ws);

      // Confirma registro
      ws.send(JSON.stringify({
        type: 'mcp_client_registered',
        mcpInstanceId,
        data: { serverId: this.mcpInstanceId }
      }));

      // Informa status do background
      ws.send(JSON.stringify({
        type: 'background_status',
        mcpInstanceId,
        data: { connected: this.isBackgroundConnected() }
      }));

      return;
    }

    // Background.js se registrando
    if (type === 'background_ready' && sessionId === '__background__') {
      console.error('[Bridge] Background controller connected!');

      this.backgroundClient = ws;
      const clientInfo: SessionClient = {
        ws,
        sessionId: '__background__',
        connectedAt: Date.now(),
        isBackground: true
      };

      this.clients.set(ws, clientInfo);

      // Notifica todos os clientes MCP sobre o background
      for (const [mcpId, mcpWs] of this.mcpClients) {
        if (mcpWs.readyState === WebSocket.OPEN) {
          mcpWs.send(JSON.stringify({
            type: 'background_status',
            mcpInstanceId: mcpId,
            data: { connected: true }
          }));
        }
      }

      return;
    }

    // Browser se registrando com uma sessão
    if (type === 'browser_ready' && sessionId) {
      console.error(`[Bridge] Browser ready for session: ${sessionId}`);

      const clientInfo: SessionClient = {
        ws,
        sessionId,
        url: (data as { url?: string })?.url,
        connectedAt: Date.now()
      };

      this.clients.set(ws, clientInfo);
      this.sessionClients.set(sessionId, ws);
      return;
    }

    // Resposta a um request pendente
    if (type === 'response' && requestId) {
      // First check if we have a pending request to determine the target
      const pending = this.pendingRequests.get(requestId);

      // Determine target mcpInstanceId: use from response, or from pending request
      const targetInstanceId = mcpInstanceId || pending?.mcpInstanceId;

      // If the target is a different MCP client, route to them
      if (targetInstanceId && targetInstanceId !== this.mcpInstanceId) {
        const targetMcp = this.mcpClients.get(targetInstanceId);
        if (targetMcp && targetMcp.readyState === WebSocket.OPEN) {
          // Ensure mcpInstanceId is in the message for the client
          const routedMessage = { ...message, mcpInstanceId: targetInstanceId };
          targetMcp.send(JSON.stringify(routedMessage));
        } else {
          console.error(`[Bridge] Cannot route response to ${targetInstanceId}: client not connected`);
        }
        return;
      }

      // Process locally if the request was made by this server
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);

        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error || 'Unknown error'));
        }
      }
      return;
    }

    // Comando de outro cliente MCP para o background (quando este é servidor)
    if (type.endsWith('_command') && mcpInstanceId && mcpInstanceId !== this.mcpInstanceId) {
      // Roteia para o background, mantendo o mcpInstanceId para rotear a resposta de volta
      if (this.backgroundClient && this.backgroundClient.readyState === WebSocket.OPEN) {
        this.backgroundClient.send(JSON.stringify(message));
      }
      return;
    }

    // Health check - atualiza informações do cliente
    if (type === 'health_check' && sessionId) {
      const client = this.clients.get(ws);
      if (client) {
        client.url = (data as { url?: string })?.url;
      }
      return;
    }

    // Roteamento de mensagem para sessão (quando outro cliente MCP envia)
    if (type === 'route_to_session' && sessionId && mcpInstanceId) {
      const targetWs = this.sessionClients.get(sessionId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        // Restaura o tipo original da mensagem antes de enviar para o content-script
        const originalType = (message as { originalType?: string }).originalType;
        const forwardMessage: BridgeMessage = {
          type: originalType || 'unknown',
          requestId: message.requestId,
          sessionId: message.sessionId,
          mcpInstanceId: message.mcpInstanceId,
          data: message.data
        };
        targetWs.send(JSON.stringify(forwardMessage));
      } else {
        // Sessão não encontrada, envia erro de volta
        const sourceClient = this.mcpClients.get(mcpInstanceId);
        if (sourceClient && sourceClient.readyState === WebSocket.OPEN) {
          sourceClient.send(JSON.stringify({
            type: 'response',
            requestId: message.requestId,
            mcpInstanceId,
            success: false,
            error: `No browser connected for session: ${sessionId}`
          }));
        }
      }
      return;
    }

    // Outras mensagens informativas
    if (type === 'dialog_opened') {
      console.error(`[Bridge] Dialog opened in session ${sessionId}:`, JSON.stringify(data));
    } else {
      console.error(`[Bridge] Received from session ${sessionId}:`, type);
    }
  }

  /**
   * Envia mensagem e aguarda resposta - PARA A SESSÃO ATUAL
   * Default timeout reduced to 20s for faster feedback
   */
  async sendAndWait(message: BridgeMessage, timeout: number = 10000): Promise<unknown> {
    if (!this.currentSessionId) {
      throw new Error('No session active. Call create_automation_session first.');
    }

    return this.sendAndWaitToSession(this.currentSessionId, message, timeout);
  }

  /**
   * Envia mensagem para uma sessão específica e aguarda resposta
   * Timeout reduzido para feedback mais rápido
   */
  async sendAndWaitToSession(sessionId: string, message: BridgeMessage, timeout: number = 10000): Promise<unknown> {
    const requestId = `req_${++this.requestCounter}_${Date.now()}`;
    message.requestId = requestId;
    message.sessionId = sessionId;
    message.mcpInstanceId = this.mcpInstanceId;

    return new Promise((resolve, reject) => {
      this.checkPendingRequestLimit();

      let ws: WebSocket | null = null;

      // Verifica conexão antes de criar o request
      if (this.isServerMode) {
        ws = this.sessionClients.get(sessionId) || null;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error(`No browser connected for session: ${sessionId}. The page may have navigated - use wait_for_element or page_ready first.`));
          return;
        }
      } else {
        ws = this.clientWs;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Not connected to bridge server.'));
          return;
        }
      }

      const timeoutHandle = setTimeout(() => {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          // Check if connection is still valid
          const currentWs = this.isServerMode ? this.sessionClients.get(sessionId) : this.clientWs;
          const isStillConnected = currentWs && currentWs.readyState === WebSocket.OPEN;

          const errorMsg = isStillConnected
            ? `Timeout after ${Math.round(timeout/1000)}s for ${message.type}. The operation may still be in progress.`
            : `Timeout after ${Math.round(timeout/1000)}s for ${message.type}. Browser connection lost - page may have navigated.`;

          reject(new Error(errorMsg));
        }
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        sessionId,
        mcpInstanceId: this.mcpInstanceId
      });

      try {
        if (this.isServerMode) {
          ws!.send(JSON.stringify(message));
        } else {
          // Modo cliente: envia via servidor
          const routeMessage = {
            ...message,
            originalType: message.type,
            type: 'route_to_session'
          };
          ws!.send(JSON.stringify(routeMessage));
        }
      } catch (sendError) {
        // Se falhar ao enviar, limpa o request pendente
        this.pendingRequests.delete(requestId);
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to send message: ${(sendError as Error).message}`));
      }
    });
  }

  /**
   * Envia mensagem para todos os clientes de uma sessão (broadcast)
   */
  sendToSession(sessionId: string, message: BridgeMessage): void {
    const ws = this.sessionClients.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      message.sessionId = sessionId;
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Verifica se há conexão para a sessão atual
   */
  isConnected(): boolean {
    if (!this.currentSessionId) return false;

    // Em modo cliente, consideramos conectado se estamos conectados ao servidor
    // A sessão real é gerenciada pelo servidor
    if (!this.isServerMode) {
      return this.clientWs !== null && this.clientWs.readyState === WebSocket.OPEN;
    }

    return this.isSessionConnected(this.currentSessionId);
  }

  /**
   * Verifica se há conexão para uma sessão específica
   */
  isSessionConnected(sessionId: string): boolean {
    if (!this.isServerMode) {
      // Em modo cliente, assumimos que a sessão existe se estamos conectados
      return this.clientWs !== null && this.clientWs.readyState === WebSocket.OPEN;
    }

    const ws = this.sessionClients.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Retorna número total de conexões
   */
  getConnectionCount(): number {
    if (!this.isServerMode) {
      return this.clientWs && this.clientWs.readyState === WebSocket.OPEN ? 1 : 0;
    }
    return this.clients.size;
  }

  /**
   * Retorna lista de sessões conectadas
   */
  getConnectedSessions(): string[] {
    if (!this.isServerMode) {
      // Em modo cliente, retorna a sessão atual se existir
      return this.currentSessionId ? [this.currentSessionId] : [];
    }
    return Array.from(this.sessionClients.keys());
  }

  /**
   * Retorna informações de todas as sessões
   */
  getSessionsInfo(): Array<{ sessionId: string; url?: string; connectedAt: number }> {
    const info: Array<{ sessionId: string; url?: string; connectedAt: number }> = [];

    if (!this.isServerMode) {
      // Em modo cliente, retorna informação básica
      if (this.currentSessionId) {
        info.push({
          sessionId: this.currentSessionId,
          connectedAt: Date.now()
        });
      }
      return info;
    }

    for (const [, client] of this.clients) {
      if (!client.isMcpClient && !client.isBackground) {
        info.push({
          sessionId: client.sessionId,
          url: client.url,
          connectedAt: client.connectedAt
        });
      }
    }

    return info;
  }

  /**
   * Retorna se está operando em modo servidor
   */
  isServer(): boolean {
    return this.isServerMode;
  }

  /**
   * Retorna o número de clientes MCP conectados (apenas em modo servidor)
   */
  getMcpClientCount(): number {
    return this.mcpClients.size;
  }

  stop(): void {
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Stop ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Limpa requests pendentes
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Server stopping'));
    }
    this.pendingRequests.clear();

    if (this.isServerMode) {
      // Modo servidor: fecha todas as conexões
      for (const [ws] of this.clients) {
        ws.close();
      }
      this.clients.clear();
      this.sessionClients.clear();
      this.mcpClients.clear();

      // Fecha servidor
      this.wss?.close();
      this.wss = null;
    } else {
      // Modo cliente: fecha conexão com o servidor
      if (this.clientWs) {
        this.clientWs.close();
        this.clientWs = null;
      }
    }

    this.backgroundClient = null;
    console.error(`[Bridge] Stopped (instance: ${this.mcpInstanceId})`);
  }
}
