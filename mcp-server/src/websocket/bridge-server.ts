/**
 * Universal Browser MCP - WebSocket Bridge Server
 * Gerencia múltiplas sessões de automação isoladas
 * Suporta conexão de controle do background.js
 */

import { WebSocketServer, WebSocket } from 'ws';

export interface BridgeMessage {
  type: string;
  data?: unknown;
  requestId?: string;
  sessionId?: string;
  success?: boolean;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  sessionId: string;
}

interface SessionClient {
  ws: WebSocket;
  sessionId: string;
  url?: string;
  connectedAt: number;
  isBackground?: boolean;
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

  constructor(port: number = 3002) {
    this.port = port;
  }

  /**
   * Verifica se o background está conectado
   */
  isBackgroundConnected(): boolean {
    return this.backgroundClient !== null && this.backgroundClient.readyState === WebSocket.OPEN;
  }

  /**
   * Envia comando para o background criar uma sessão
   */
  async createSessionViaBackground(sessionId: string, url?: string): Promise<unknown> {
    if (!this.isBackgroundConnected()) {
      throw new Error('Background not connected. Please ensure the Chrome extension is running.');
    }

    const requestId = `bg_${++this.requestCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Timeout waiting for background to create session'));
      }, 15000);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        sessionId: '__background__'
      });

      this.backgroundClient!.send(JSON.stringify({
        type: 'create_session_command',
        requestId,
        sessionId: '__background__',
        data: { sessionId, url: url || 'about:blank' }
      }));
    });
  }

  /**
   * Envia comando genérico para o background
   */
  async sendCommandToBackground(commandType: string, data?: unknown): Promise<unknown> {
    if (!this.isBackgroundConnected()) {
      throw new Error('Background not connected. Please ensure the Chrome extension is running.');
    }

    const requestId = `bg_${++this.requestCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timeout waiting for background command: ${commandType}`));
      }, 30000);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        sessionId: '__background__'
      });

      this.backgroundClient!.send(JSON.stringify({
        type: commandType,
        requestId,
        sessionId: '__background__',
        data
      }));
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

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          console.error(`[Bridge] WebSocket server running on port ${this.port}`);
          resolve();
        });

        this.wss.on('connection', (ws: WebSocket) => {
          console.error('[Bridge] New browser connection');

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
              console.error(`[Bridge] Browser disconnected (session: ${client.sessionId})`);
              if (client.isBackground) {
                this.backgroundClient = null;
                console.error('[Bridge] Background controller disconnected');
              } else {
                this.sessionClients.delete(client.sessionId);
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
              } else {
                this.sessionClients.delete(client.sessionId);
              }
            }
            this.clients.delete(ws);
          });
        });

        this.wss.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`[Bridge] Port ${this.port} already in use - another MCP instance is running`);
            console.error('[Bridge] This is OK - will connect to existing bridge server');
            // Não rejeita, apenas avisa
            resolve();
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

  private handleMessage(ws: WebSocket, message: BridgeMessage): void {
    const { type, requestId, sessionId, success, data, error } = message;

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

    // Health check - atualiza informações do cliente
    if (type === 'health_check' && sessionId) {
      const client = this.clients.get(ws);
      if (client) {
        client.url = (data as { url?: string })?.url;
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
   */
  async sendAndWait(message: BridgeMessage, timeout: number = 30000): Promise<unknown> {
    if (!this.currentSessionId) {
      throw new Error('No session active. Call create_automation_session first.');
    }

    return this.sendAndWaitToSession(this.currentSessionId, message, timeout);
  }

  /**
   * Envia mensagem para uma sessão específica e aguarda resposta
   */
  async sendAndWaitToSession(sessionId: string, message: BridgeMessage, timeout: number = 30000): Promise<unknown> {
    const ws = this.sessionClients.get(sessionId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`No browser connected for session: ${sessionId}. Make sure the automation window is open.`);
    }

    const requestId = `req_${++this.requestCounter}_${Date.now()}`;
    message.requestId = requestId;
    message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        sessionId
      });

      ws.send(JSON.stringify(message));
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
    return this.isSessionConnected(this.currentSessionId);
  }

  /**
   * Verifica se há conexão para uma sessão específica
   */
  isSessionConnected(sessionId: string): boolean {
    const ws = this.sessionClients.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Retorna número total de conexões
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Retorna lista de sessões conectadas
   */
  getConnectedSessions(): string[] {
    return Array.from(this.sessionClients.keys());
  }

  /**
   * Retorna informações de todas as sessões
   */
  getSessionsInfo(): Array<{ sessionId: string; url?: string; connectedAt: number }> {
    const info: Array<{ sessionId: string; url?: string; connectedAt: number }> = [];

    for (const [, client] of this.clients) {
      info.push({
        sessionId: client.sessionId,
        url: client.url,
        connectedAt: client.connectedAt
      });
    }

    return info;
  }

  stop(): void {
    // Limpa requests pendentes
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Server stopping'));
    }
    this.pendingRequests.clear();

    // Fecha conexões
    for (const [ws] of this.clients) {
      ws.close();
    }
    this.clients.clear();
    this.sessionClients.clear();

    // Fecha servidor
    this.wss?.close();
    this.wss = null;
  }
}
