/**
 * UniversalBrowserBridge - Content script orchestrator
 */

import { createWebSocket, getReconnectDelay } from './bridge/websocket-manager.js';
import { createStatusIndicator, updateStatusIndicator } from './bridge/status-indicator.js';
import { routeMessage, interceptDialogs, stopInterceptingDialogs } from './bridge/message-router.js';
import { startHealthCheck } from './bridge/health-monitor.js';

export class UniversalBrowserBridge {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.statusIndicator = null;
    this.pendingRequests = new Map();

    this.sessionId = null;
    this.isAutomationTab = false;
    this.healthCheckInterval = null;

    this.init();
  }

  async init() {
    const result = await this.checkIfAutomationTab();

    if (result.isAutomationTab) {
      this.isAutomationTab = true;
      this.sessionId = result.sessionId;

      console.log(`[Universal MCP] Automation tab detected! Session: ${this.sessionId}`);

      interceptDialogs(this.sessionId, (msg) => this.sendMessage(msg));
      this.statusIndicator = createStatusIndicator(this.sessionId, () => this.showDebugInfo());
      this.connect();
      this.healthCheckInterval = startHealthCheck(this.sessionId, (msg) => {
        if (this.isConnected && this.sessionId) {
          this.sendMessage(msg);
        }
      });
    } else {
      console.log('[Universal MCP] Not an automation tab, staying dormant');
      this.startAutomationCheck();
    }
  }

  checkIfAutomationTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'is_automation_tab' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ isAutomationTab: false });
          return;
        }
        resolve(response || { isAutomationTab: false });
      });
    });
  }

  startAutomationCheck() {
    const checkInterval = setInterval(async () => {
      const result = await this.checkIfAutomationTab();

      if (result.isAutomationTab) {
        clearInterval(checkInterval);
        this.isAutomationTab = true;
        this.sessionId = result.sessionId;

        console.log(`[Universal MCP] Tab became automation tab! Session: ${this.sessionId}`);

        interceptDialogs(this.sessionId, (msg) => this.sendMessage(msg));
        this.statusIndicator = createStatusIndicator(this.sessionId, () => this.showDebugInfo());
        this.connect();
        this.healthCheckInterval = startHealthCheck(this.sessionId, (msg) => {
          if (this.isConnected && this.sessionId) {
            this.sendMessage(msg);
          }
        });
      }
    }, 1000);

    setTimeout(() => clearInterval(checkInterval), 30000);
  }

  showDebugInfo() {
    const info = {
      sessionId: this.sessionId,
      status: this.isConnected ? 'Connected' : 'Disconnected',
      url: window.location.href,
      title: document.title,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
      timestamp: new Date().toISOString()
    };

    alert(`Universal Browser MCP\n\nAutomation Session\n\n${JSON.stringify(info, null, 2)}`);
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (!this.sessionId) {
      console.log('[Universal MCP] No sessionId, not connecting');
      return;
    }

    this.updateStatus('connecting');

    try {
      this.ws = createWebSocket(this.sessionId, {
        onConnected: () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.updateStatus('connected');
        },
        onMessage: (message) => this.handleMessage(message),
        onDisconnected: () => {
          this.isConnected = false;
          this.updateStatus('disconnected');
          this.scheduleReconnect();
        },
        onError: () => {
          this.updateStatus('error');
        }
      });
    } catch (error) {
      console.error('[Universal MCP] Failed to connect:', error);
      this.updateStatus('error');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Universal MCP] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = getReconnectDelay(this.reconnectAttempts);

    console.log(`[Universal MCP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  updateStatus(status) {
    updateStatusIndicator(this.statusIndicator, status, this.sessionId);
  }

  sendMessage(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      message.sessionId = this.sessionId;
      this.ws.send(JSON.stringify(message));
    }
  }

  sendResponse(requestId, success, data, error = null, mcpInstanceId = null) {
    this.sendMessage({
      type: 'response',
      requestId,
      sessionId: this.sessionId,
      mcpInstanceId,
      success,
      data,
      error
    });
  }

  async handleMessage(message) {
    const { type, requestId, data, mcpInstanceId } = message;

    const dataSize = data ? JSON.stringify(data).length : 0;
    console.log(`[Universal MCP] [${this.sessionId}] Received:`, type, `(${dataSize} bytes)`, mcpInstanceId ? `(from: ${mcpInstanceId})` : '');
    this.updateStatus('processing');

    const globalTimeoutMs = 60000;
    let responded = false;

    const sendOnce = (success, result, error) => {
      if (responded) return;
      responded = true;
      this.sendResponse(requestId, success, result, error, mcpInstanceId);
      this.updateStatus(this.isConnected ? 'connected' : 'disconnected');
    };

    const globalTimeout = setTimeout(() => {
      if (!responded) {
        console.error(`[Universal MCP] Global timeout for ${type}`);
        sendOnce(false, null, `Global timeout (${globalTimeoutMs}ms) for operation: ${type}`);
      }
    }, globalTimeoutMs);

    try {
      const result = await routeMessage(type, data, this.sessionId);
      clearTimeout(globalTimeout);
      sendOnce(true, result, null);
    } catch (error) {
      clearTimeout(globalTimeout);
      console.error('[Universal MCP] Handler error:', error);
      sendOnce(false, null, error.message);
    }
  }

  destroy() {
    stopInterceptingDialogs();
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.statusIndicator) {
      this.statusIndicator.remove();
      this.statusIndicator = null;
    }
    this.isConnected = false;
  }
}
