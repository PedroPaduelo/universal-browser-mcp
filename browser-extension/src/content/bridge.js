/**
 * UniversalBrowserBridge - Classe principal do content script
 */

import { interceptDialogs, handleGetLastDialog, handleGetDialogQueue, handleClearDialogQueue, handleSetDialogAutoAccept } from './handlers/dialog.js';
import { handleNavigateTo, handleGoBack, handleGoForward, handleRefresh, handleGetCurrentUrl } from './handlers/navigation.js';
import { handleGetPageInfo, handleGetPageTitle, handleGetPageText, handleGetPageHtml, handleExtractLinks, handleGetPageSnapshot } from './handlers/page-info.js';
import { handleClickElement, handleDoubleClick, handleHoverElement, handlePressKey, handleTypeText, handleFocusElement, handleGetActiveElement, handleScrollTo } from './handlers/interaction.js';
import { handleFillField, handleFillForm, handleSelectOption, handleExtractFormData } from './handlers/form.js';
import { handleWaitForElement, handleWaitForText } from './handlers/wait.js';
import { handleExtractText, handleExtractTable, handleExtractHtml, handleExtractStyles, handleGetStylesheets } from './handlers/extraction.js';
import { handleValidatePage } from './handlers/validation.js';
import { handleExecuteScript } from './handlers/script.js';
import { handleGetElementInfo } from './handlers/element-info.js';
import { handleBatchActions } from './handlers/batch.js';
import { handleGetAccessibilityTree, handleFindByRole, handleHighlightElement, handleGetElementCenter } from './handlers/accessibility.js';
import { handleSmartWait, handlePageReady, handleRetryAction } from './handlers/smart-wait.js';

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

    this.init();
  }

  async init() {
    const result = await this.checkIfAutomationTab();

    if (result.isAutomationTab) {
      this.isAutomationTab = true;
      this.sessionId = result.sessionId;

      console.log(`[Universal MCP] Automation tab detected! Session: ${this.sessionId}`);

      interceptDialogs(this.sessionId, (msg) => this.sendMessage(msg));
      this.createStatusIndicator();
      this.connect();
      this.startHealthCheck();
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
        this.createStatusIndicator();
        this.connect();
        this.startHealthCheck();
      }
    }, 1000);

    setTimeout(() => clearInterval(checkInterval), 30000);
  }

  // ==================== STATUS INDICATOR ====================

  createStatusIndicator() {
    if (document.getElementById('mcp-universal-status')) return;

    this.statusIndicator = document.createElement('div');
    this.statusIndicator.id = 'mcp-universal-status';
    this.statusIndicator.innerHTML = '🤖';
    this.statusIndicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #f59e0b;
      z-index: 2147483647;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      user-select: none;
      border: 2px solid #fff;
    `;

    this.statusIndicator.addEventListener('click', () => this.showDebugInfo());

    const appendIndicator = () => {
      if (document.body) {
        document.body.appendChild(this.statusIndicator);
      } else {
        requestAnimationFrame(appendIndicator);
      }
    };
    appendIndicator();
  }

  updateStatus(status) {
    if (!this.statusIndicator) return;

    const states = {
      connecting: { bg: '#f59e0b', emoji: '🔄', title: `[${this.sessionId}] Conectando...` },
      connected: { bg: '#22c55e', emoji: '🤖', title: `[${this.sessionId}] Conectado` },
      disconnected: { bg: '#ef4444', emoji: '❌', title: `[${this.sessionId}] Desconectado` },
      processing: { bg: '#3b82f6', emoji: '⚙️', title: `[${this.sessionId}] Processando...` },
      error: { bg: '#dc2626', emoji: '⚠️', title: `[${this.sessionId}] Erro` }
    };

    const state = states[status] || states.disconnected;
    this.statusIndicator.style.background = state.bg;
    this.statusIndicator.innerHTML = state.emoji;
    this.statusIndicator.title = state.title;
  }

  showDebugInfo() {
    const info = {
      sessionId: this.sessionId,
      status: this.isConnected ? 'Conectado' : 'Desconectado',
      url: window.location.href,
      title: document.title,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
      timestamp: new Date().toISOString()
    };

    alert(`Universal Browser MCP\n\nSessão de Automação\n\n${JSON.stringify(info, null, 2)}`);
  }

  // ==================== WEBSOCKET CONNECTION ====================

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (!this.sessionId) {
      console.log('[Universal MCP] No sessionId, not connecting');
      return;
    }

    this.updateStatus('connecting');

    try {
      this.ws = new WebSocket('ws://localhost:3002');

      this.ws.onopen = () => {
        console.log(`[Universal MCP] Connected to bridge server (session: ${this.sessionId})`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateStatus('connected');

        this.sendMessage({
          type: 'browser_ready',
          sessionId: this.sessionId,
          data: {
            url: window.location.href,
            title: document.title,
            timestamp: Date.now()
          }
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.sessionId && message.sessionId !== this.sessionId) {
            console.log(`[Universal MCP] Ignoring message for different session: ${message.sessionId}`);
            return;
          }

          this.handleMessage(message);
        } catch (error) {
          console.error('[Universal MCP] Error parsing message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[Universal MCP] Connection closed');
        this.isConnected = false;
        this.updateStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[Universal MCP] WebSocket error:', error);
        this.updateStatus('error');
      };

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
    // Faster reconnect: 500ms, 1s, 2s, 4s, max 10s
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts - 1), 10000);

    console.log(`[Universal MCP] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  startHealthCheck() {
    setInterval(() => {
      if (this.isConnected && this.sessionId) {
        this.sendMessage({
          type: 'health_check',
          sessionId: this.sessionId,
          data: { url: window.location.href }
        });
      }
    }, 30000);
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
      mcpInstanceId, // CRITICAL: Include for proper routing between MCP instances
      success,
      data,
      error
    });
  }

  // ==================== MESSAGE HANDLER ====================

  async handleMessage(message) {
    const { type, requestId, data, mcpInstanceId } = message;

    // Log apenas o tipo, não os dados (podem ser grandes)
    const dataSize = data ? JSON.stringify(data).length : 0;
    console.log(`[Universal MCP] [${this.sessionId}] Received:`, type, `(${dataSize} bytes)`, mcpInstanceId ? `(from: ${mcpInstanceId})` : '');
    this.updateStatus('processing');

    // Global timeout to ensure response is always sent (max 60s for long operations)
    // Most operations should complete in < 30s
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
      let result;

      switch (type) {
        // Navegação
        case 'navigate_to':
          result = await handleNavigateTo(data);
          break;
        case 'go_back':
          result = await handleGoBack();
          break;
        case 'go_forward':
          result = await handleGoForward();
          break;
        case 'refresh':
          result = await handleRefresh();
          break;
        case 'get_current_url':
          result = handleGetCurrentUrl();
          break;

        // Informações da página
        case 'get_page_info':
          result = handleGetPageInfo(this.sessionId);
          break;
        case 'get_page_title':
          result = handleGetPageTitle();
          break;
        case 'get_page_text':
          result = handleGetPageText(data);
          break;
        case 'get_page_html':
          result = handleGetPageHtml(data);
          break;

        // Interação DOM
        case 'fill_field':
          result = await handleFillField(data);
          break;
        case 'fill_form':
          result = await handleFillForm(data);
          break;
        case 'click_element':
          result = await handleClickElement(data);
          break;
        case 'select_option':
          result = await handleSelectOption(data);
          break;
        case 'hover_element':
          result = await handleHoverElement(data);
          break;
        case 'type_text':
          result = await handleTypeText(data);
          break;
        case 'scroll_to':
          result = await handleScrollTo(data);
          break;

        // Espera
        case 'wait_for_element':
          result = await handleWaitForElement(data);
          break;
        case 'wait_for_text':
          result = await handleWaitForText(data);
          break;

        // Extração
        case 'extract_text':
          result = handleExtractText(data);
          break;
        case 'extract_table':
          result = handleExtractTable(data);
          break;
        case 'extract_links':
          result = handleExtractLinks(data);
          break;
        case 'extract_form_data':
          result = handleExtractFormData(data);
          break;

        // CSS e Validação
        case 'extract_styles':
          result = handleExtractStyles(data);
          break;
        case 'extract_html':
          result = handleExtractHtml(data);
          break;
        case 'validate_page':
          result = handleValidatePage(data);
          break;
        case 'get_stylesheets':
          result = handleGetStylesheets();
          break;

        // Dialog handling
        case 'get_last_dialog':
          result = handleGetLastDialog();
          break;
        case 'get_dialog_queue':
          result = handleGetDialogQueue();
          break;
        case 'clear_dialog_queue':
          result = handleClearDialogQueue();
          break;
        case 'set_dialog_auto_accept':
          result = handleSetDialogAutoAccept(data);
          break;

        // Novas funcionalidades
        case 'press_key':
          result = await handlePressKey(data);
          break;
        case 'get_element_info':
          result = handleGetElementInfo(data);
          break;
        case 'double_click':
          result = await handleDoubleClick(data);
          break;
        case 'focus_element':
          result = await handleFocusElement(data);
          break;
        case 'get_active_element':
          result = handleGetActiveElement();
          break;

        // Execução de script customizado
        case 'execute_script':
          result = await handleExecuteScript(data);
          break;

        // Batch operations
        case 'batch_actions':
          result = await handleBatchActions(data);
          break;

        // Page snapshot (lightweight)
        case 'get_page_snapshot':
          result = handleGetPageSnapshot();
          break;

        // Accessibility tree
        case 'get_accessibility_tree':
          result = handleGetAccessibilityTree(data);
          break;

        // Find by role
        case 'find_by_role':
          result = handleFindByRole(data);
          break;

        // Smart wait with conditions
        case 'smart_wait':
          result = await handleSmartWait(data);
          break;

        // Page ready check
        case 'page_ready':
          result = await handlePageReady(data);
          break;

        // Highlight element (debugging)
        case 'highlight_element':
          result = await handleHighlightElement(data);
          break;

        // Retry action
        case 'retry_action':
          result = await handleRetryAction(data);
          break;

        // Get element center
        case 'get_element_center':
          result = handleGetElementCenter(data);
          break;

        default:
          throw new Error(`Unknown message type: ${type}`);
      }

      clearTimeout(globalTimeout);
      sendOnce(true, result, null);

    } catch (error) {
      clearTimeout(globalTimeout);
      console.error('[Universal MCP] Handler error:', error);
      sendOnce(false, null, error.message);
    }
  }
}
