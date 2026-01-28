/**
 * Universal Browser MCP - Content Script
 * Só conecta ao WebSocket se estiver em uma aba de automação
 */

class UniversalBrowserBridge {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.statusIndicator = null;
    this.pendingRequests = new Map();

    // Sessão de automação
    this.sessionId = null;
    this.isAutomationTab = false;

    // Dialog handling
    this.lastDialog = null;
    this.dialogQueue = [];
    this.autoAcceptDialogs = true;

    this.init();
  }

  async init() {
    // Primeiro verifica se esta aba é uma aba de automação
    const result = await this.checkIfAutomationTab();

    if (result.isAutomationTab) {
      this.isAutomationTab = true;
      this.sessionId = result.sessionId;

      console.log(`[Universal MCP] Automation tab detected! Session: ${this.sessionId}`);

      this.interceptDialogs();
      this.createStatusIndicator();
      this.connect();
      this.startHealthCheck();
    } else {
      console.log('[Universal MCP] Not an automation tab, staying dormant');
      // Fica em modo dormant, só escutando por mudanças
      this.startAutomationCheck();
    }
  }

  /**
   * Verifica com o background se esta aba pertence a uma sessão de automação
   */
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

  /**
   * Verifica periodicamente se virou aba de automação (para abas abertas depois)
   */
  startAutomationCheck() {
    const checkInterval = setInterval(async () => {
      const result = await this.checkIfAutomationTab();

      if (result.isAutomationTab) {
        clearInterval(checkInterval);
        this.isAutomationTab = true;
        this.sessionId = result.sessionId;

        console.log(`[Universal MCP] Tab became automation tab! Session: ${this.sessionId}`);

        this.interceptDialogs();
        this.createStatusIndicator();
        this.connect();
        this.startHealthCheck();
      }
    }, 1000);

    // Para de verificar após 30 segundos se não virou automation tab
    setTimeout(() => clearInterval(checkInterval), 30000);
  }

  // ==================== DIALOG INTERCEPTION ====================

  interceptDialogs() {
    const self = this;

    const originalAlert = window.alert.bind(window);
    const originalConfirm = window.confirm.bind(window);
    const originalPrompt = window.prompt.bind(window);

    window.alert = function(message) {
      console.log('[Universal MCP] Alert intercepted:', message);
      self.lastDialog = {
        type: 'alert',
        message: String(message),
        timestamp: Date.now()
      };
      self.dialogQueue.push(self.lastDialog);

      self.sendMessage({
        type: 'dialog_opened',
        sessionId: self.sessionId,
        data: self.lastDialog
      });

      if (self.autoAcceptDialogs) {
        return undefined;
      }
      return originalAlert(message);
    };

    window.confirm = function(message) {
      console.log('[Universal MCP] Confirm intercepted:', message);
      self.lastDialog = {
        type: 'confirm',
        message: String(message),
        timestamp: Date.now()
      };
      self.dialogQueue.push(self.lastDialog);

      self.sendMessage({
        type: 'dialog_opened',
        sessionId: self.sessionId,
        data: self.lastDialog
      });

      if (self.autoAcceptDialogs) {
        self.lastDialog.result = true;
        return true;
      }
      const result = originalConfirm(message);
      self.lastDialog.result = result;
      return result;
    };

    window.prompt = function(message, defaultValue) {
      console.log('[Universal MCP] Prompt intercepted:', message);
      self.lastDialog = {
        type: 'prompt',
        message: String(message),
        defaultValue: defaultValue || '',
        timestamp: Date.now()
      };
      self.dialogQueue.push(self.lastDialog);

      self.sendMessage({
        type: 'dialog_opened',
        sessionId: self.sessionId,
        data: self.lastDialog
      });

      if (self.autoAcceptDialogs) {
        self.lastDialog.result = defaultValue || '';
        return defaultValue || '';
      }
      const result = originalPrompt(message, defaultValue);
      self.lastDialog.result = result;
      return result;
    };

    console.log('[Universal MCP] Dialog interception enabled');
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

    // Aguarda o body estar disponível
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

        // Envia informações da página atual COM o sessionId
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

          // IMPORTANTE: Só processa mensagens para esta sessão
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
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

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
      // Sempre inclui o sessionId
      message.sessionId = this.sessionId;
      this.ws.send(JSON.stringify(message));
    }
  }

  sendResponse(requestId, success, data, error = null, mcpInstanceId = null) {
    this.sendMessage({
      type: 'response',
      requestId,
      sessionId: this.sessionId,
      mcpInstanceId, // Inclui o ID da instância MCP para roteamento correto
      success,
      data,
      error
    });
  }

  // ==================== MESSAGE HANDLER ====================

  async handleMessage(message) {
    const { type, requestId, data, mcpInstanceId } = message;

    console.log(`[Universal MCP] [${this.sessionId}] Received:`, type, mcpInstanceId ? `(from: ${mcpInstanceId})` : '');
    this.updateStatus('processing');

    try {
      let result;

      switch (type) {
        // Navegação
        case 'navigate_to':
          result = await this.handleNavigateTo(data);
          break;
        case 'go_back':
          result = await this.handleGoBack();
          break;
        case 'go_forward':
          result = await this.handleGoForward();
          break;
        case 'refresh':
          result = await this.handleRefresh();
          break;
        case 'get_current_url':
          result = this.handleGetCurrentUrl();
          break;

        // Informações da página
        case 'get_page_info':
          result = this.handleGetPageInfo();
          break;
        case 'get_page_title':
          result = this.handleGetPageTitle();
          break;
        case 'get_page_text':
          result = this.handleGetPageText(data);
          break;
        case 'get_page_html':
          result = this.handleGetPageHtml(data);
          break;

        // Interação DOM
        case 'fill_field':
          result = await this.handleFillField(data);
          break;
        case 'fill_form':
          result = await this.handleFillForm(data);
          break;
        case 'click_element':
          result = await this.handleClickElement(data);
          break;
        case 'select_option':
          result = await this.handleSelectOption(data);
          break;
        case 'hover_element':
          result = await this.handleHoverElement(data);
          break;
        case 'type_text':
          result = await this.handleTypeText(data);
          break;
        case 'scroll_to':
          result = await this.handleScrollTo(data);
          break;

        // Espera
        case 'wait_for_element':
          result = await this.handleWaitForElement(data);
          break;
        case 'wait_for_text':
          result = await this.handleWaitForText(data);
          break;

        // Extração
        case 'extract_text':
          result = this.handleExtractText(data);
          break;
        case 'extract_table':
          result = this.handleExtractTable(data);
          break;
        case 'extract_links':
          result = this.handleExtractLinks(data);
          break;
        case 'extract_form_data':
          result = this.handleExtractFormData(data);
          break;

        // CSS e Validação
        case 'extract_styles':
          result = this.handleExtractStyles(data);
          break;
        case 'extract_html':
          result = this.handleExtractHtml(data);
          break;
        case 'validate_page':
          result = this.handleValidatePage(data);
          break;
        case 'get_stylesheets':
          result = this.handleGetStylesheets();
          break;

        // Dialog handling
        case 'get_last_dialog':
          result = this.handleGetLastDialog();
          break;
        case 'get_dialog_queue':
          result = this.handleGetDialogQueue();
          break;
        case 'clear_dialog_queue':
          result = this.handleClearDialogQueue();
          break;
        case 'set_dialog_auto_accept':
          result = this.handleSetDialogAutoAccept(data);
          break;

        // Novas funcionalidades
        case 'press_key':
          result = await this.handlePressKey(data);
          break;
        case 'get_element_info':
          result = this.handleGetElementInfo(data);
          break;
        case 'double_click':
          result = await this.handleDoubleClick(data);
          break;
        case 'focus_element':
          result = await this.handleFocusElement(data);
          break;
        case 'get_active_element':
          result = this.handleGetActiveElement();
          break;

        // Execução de script customizado
        case 'execute_script':
          result = await this.handleExecuteScript(data);
          break;

        default:
          throw new Error(`Unknown message type: ${type}`);
      }

      // Inclui mcpInstanceId na resposta para roteamento correto
      this.sendResponse(requestId, true, result, null, mcpInstanceId);

    } catch (error) {
      console.error('[Universal MCP] Handler error:', error);
      this.sendResponse(requestId, false, null, error.message, mcpInstanceId);
    }

    this.updateStatus(this.isConnected ? 'connected' : 'disconnected');
  }

  // ==================== NAVEGAÇÃO ====================

  async handleNavigateTo(data) {
    const { url } = data;
    window.location.href = url;
    return { navigating: true, url };
  }

  async handleGoBack() {
    window.history.back();
    return { action: 'back' };
  }

  async handleGoForward() {
    window.history.forward();
    return { action: 'forward' };
  }

  async handleRefresh() {
    window.location.reload();
    return { action: 'refresh' };
  }

  handleGetCurrentUrl() {
    return {
      url: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash
    };
  }

  // ==================== INFORMAÇÕES DA PÁGINA ====================

  handleGetPageInfo() {
    const forms = this.extractForms();
    const buttons = this.extractButtons();
    const linksResult = this.handleExtractLinks({ limit: 50 });
    const inputs = this.extractInputs();
    const clickableElements = this.getClickableElements();

    return {
      sessionId: this.sessionId,
      url: window.location.href,
      title: document.title,
      forms,
      buttons,
      links: linksResult.data,
      inputs,
      clickableElements,
      meta: {
        hasPassword: !!document.querySelector('input[type="password"]'),
        hasSearch: !!document.querySelector('input[type="search"]'),
        formCount: forms.length,
        buttonCount: buttons.length,
        linkCount: linksResult.data.length,
        inputCount: inputs.length,
        clickableCount: clickableElements.length
      }
    };
  }

  extractForms() {
    const forms = [];
    document.querySelectorAll('form').forEach((form, index) => {
      const fields = [];

      form.querySelectorAll('input, select, textarea').forEach(field => {
        const label = this.findLabelForField(field);
        fields.push({
          type: field.tagName.toLowerCase(),
          inputType: field.type || null,
          name: field.name || null,
          id: field.id || null,
          label: label,
          placeholder: field.placeholder || null,
          required: field.required,
          value: field.type === 'password' ? '***' : (field.value || null),
          selector: this.generateSelector(field),
          options: field.tagName === 'SELECT' ?
            [...field.options].map(o => ({ value: o.value, text: o.text })) : null
        });
      });

      forms.push({
        index,
        id: form.id || null,
        name: form.name || null,
        action: form.action || null,
        method: form.method || 'get',
        selector: this.generateSelector(form),
        fields
      });
    });

    return forms;
  }

  extractButtons() {
    const buttons = [];
    const seen = new Set();

    document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button').forEach(btn => {
      const text = btn.textContent?.trim() || btn.value || '';
      const key = `${text}-${btn.className}`;

      if (seen.has(key) || !text) return;
      seen.add(key);

      buttons.push({
        text: text.substring(0, 100),
        type: btn.type || btn.tagName.toLowerCase(),
        id: btn.id || null,
        selector: this.generateSelector(btn),
        disabled: btn.disabled || false,
        visible: this.isVisible(btn)
      });
    });

    return buttons.slice(0, 50);
  }

  extractInputs() {
    const inputs = [];

    document.querySelectorAll('input, select, textarea').forEach(field => {
      if (field.type === 'hidden') return;

      const label = this.findLabelForField(field);
      inputs.push({
        type: field.tagName.toLowerCase(),
        inputType: field.type || null,
        name: field.name || null,
        id: field.id || null,
        label,
        placeholder: field.placeholder || null,
        selector: this.generateSelector(field),
        visible: this.isVisible(field)
      });
    });

    return inputs;
  }

  handleGetPageTitle() {
    return { title: document.title };
  }

  handleGetPageText(data) {
    const { selector } = data || {};
    const element = selector ? document.querySelector(selector) : document.body;

    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    return {
      text: element.innerText?.trim() || '',
      selector: selector || 'body'
    };
  }

  handleGetPageHtml(data) {
    const { selector } = data || {};
    const element = selector ? document.querySelector(selector) : document.documentElement;

    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    return {
      html: element.outerHTML,
      selector: selector || 'html'
    };
  }

  // ==================== INTERAÇÃO DOM ====================

  async handleFillField(data) {
    const { selector, label, value } = data;

    const field = this.findField(selector, label);
    if (!field) {
      throw new Error(`Field not found: ${selector || label}`);
    }

    await this.fillFieldValue(field, value);

    return {
      filled: true,
      selector: this.generateSelector(field),
      label: this.findLabelForField(field)
    };
  }

  async handleFillForm(data) {
    const { fields } = data;
    const results = [];
    let successCount = 0;

    for (const fieldData of fields) {
      try {
        const result = await this.handleFillField(fieldData);
        results.push({ ...fieldData, success: true, ...result });
        successCount++;
      } catch (error) {
        results.push({ ...fieldData, success: false, error: error.message });
      }

      await this.delay(50);
    }

    return {
      totalFields: fields.length,
      successCount,
      failedCount: fields.length - successCount,
      results
    };
  }

  async handleClickElement(data) {
    const { selector, text, clickParent = true } = data;

    let element = null;

    if (selector) {
      element = document.querySelector(selector);
    }

    if (!element && text) {
      element = this.findElementByText(text);
    }

    if (!element) {
      throw new Error(`Element not found: ${selector || text}`);
    }

    // Se clickParent está habilitado, busca o elemento clicável mais próximo
    let targetElement = element;
    if (clickParent) {
      const clickableParent = this.findClickableParent(element);
      if (clickableParent && clickableParent !== document.body) {
        targetElement = clickableParent;
      }
    }

    // Scroll suave até o elemento
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(200);

    // Foca no elemento se possível
    if (targetElement.focus) {
      targetElement.focus();
    }

    // Obtém posição do centro do elemento
    const rect = targetElement.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Simula sequência completa de eventos de mouse
    const mouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY,
      button: 0,
      buttons: 1
    };

    // Dispara eventos na ordem correta
    targetElement.dispatchEvent(new MouseEvent('mouseenter', { ...mouseEventInit, bubbles: false }));
    targetElement.dispatchEvent(new MouseEvent('mouseover', mouseEventInit));
    targetElement.dispatchEvent(new MouseEvent('mousemove', mouseEventInit));
    targetElement.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));

    await this.delay(50);

    targetElement.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
    targetElement.dispatchEvent(new MouseEvent('click', mouseEventInit));

    // Também chama o método click() nativo como fallback
    if (targetElement.click) {
      targetElement.click();
    }

    return {
      clicked: true,
      selector: this.generateSelector(targetElement),
      text: (targetElement.textContent || targetElement.value || '').trim().substring(0, 100),
      usedParent: targetElement !== element
    };
  }

  async handleSelectOption(data) {
    const { selector, label, value, text } = data;

    const select = this.findField(selector, label);
    if (!select || select.tagName !== 'SELECT') {
      throw new Error(`Select element not found: ${selector || label}`);
    }

    let optionFound = false;

    for (const option of select.options) {
      if (
        (value && option.value === value) ||
        (text && option.text.toLowerCase().includes(text.toLowerCase()))
      ) {
        select.value = option.value;
        optionFound = true;
        break;
      }
    }

    if (!optionFound) {
      throw new Error(`Option not found: ${value || text}`);
    }

    select.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      selected: true,
      value: select.value,
      text: select.options[select.selectedIndex]?.text
    };
  }

  async handleHoverElement(data) {
    const { selector } = data;

    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    return { hovered: true, selector };
  }

  async handleTypeText(data) {
    const { selector, label, text, delay: keyDelay = 50 } = data;

    const field = this.findField(selector, label);
    if (!field) {
      throw new Error(`Field not found: ${selector || label}`);
    }

    field.focus();
    field.value = '';

    for (const char of text) {
      field.value += char;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await this.delay(keyDelay);
    }

    field.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      typed: true,
      text,
      selector: this.generateSelector(field)
    };
  }

  async handleScrollTo(data) {
    const { selector, position } = data;

    if (selector) {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (position) {
      window.scrollTo({ top: position.y || 0, left: position.x || 0, behavior: 'smooth' });
    }

    return { scrolled: true };
  }

  // ==================== ESPERA ====================

  async handleWaitForElement(data) {
    const { selector, timeout = 10000 } = data;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element && this.isVisible(element)) {
        return {
          found: true,
          selector,
          waitTime: Date.now() - startTime
        };
      }
      await this.delay(200);
    }

    throw new Error(`Timeout waiting for element: ${selector}`);
  }

  async handleWaitForText(data) {
    const { text, selector, timeout = 10000 } = data;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = selector ? document.querySelector(selector) : document.body;
      if (element && element.innerText?.includes(text)) {
        return {
          found: true,
          text,
          waitTime: Date.now() - startTime
        };
      }
      await this.delay(200);
    }

    throw new Error(`Timeout waiting for text: ${text}`);
  }

  // ==================== EXTRAÇÃO ====================

  handleExtractText(data) {
    const { selector } = data;

    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    return {
      text: element.innerText?.trim() || '',
      selector
    };
  }

  handleExtractTable(data) {
    const { selector } = data;

    const table = document.querySelector(selector || 'table');
    if (!table) {
      throw new Error(`Table not found: ${selector || 'table'}`);
    }

    const headers = [];
    const rows = [];

    table.querySelectorAll('thead th, thead td, tr:first-child th').forEach(th => {
      headers.push(th.innerText?.trim() || '');
    });

    if (headers.length === 0) {
      table.querySelectorAll('tr:first-child td').forEach(td => {
        headers.push(td.innerText?.trim() || '');
      });
    }

    const dataRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
    dataRows.forEach(tr => {
      const row = [];
      tr.querySelectorAll('td').forEach(td => {
        row.push(td.innerText?.trim() || '');
      });
      if (row.length > 0) {
        rows.push(row);
      }
    });

    return {
      headers,
      rows,
      rowCount: rows.length,
      columnCount: headers.length
    };
  }

  handleExtractLinks(data) {
    const { selector, limit = 100 } = data || {};

    const container = selector ? document.querySelector(selector) : document;
    const links = [];

    container?.querySelectorAll('a[href]').forEach(a => {
      if (links.length >= limit) return;

      const href = a.href;
      const text = a.innerText?.trim() || a.title || '';

      if (href && !href.startsWith('javascript:')) {
        links.push({
          text: text.substring(0, 200),
          href,
          selector: this.generateSelector(a)
        });
      }
    });

    return { data: links, count: links.length };
  }

  handleExtractFormData(data) {
    const { selector } = data || {};

    const form = selector ? document.querySelector(selector) : document.querySelector('form');
    if (!form) {
      throw new Error('Form not found');
    }

    const formData = {};
    const formElements = form.querySelectorAll('input, select, textarea');

    formElements.forEach(field => {
      const name = field.name || field.id;
      if (!name) return;

      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked) {
          formData[name] = field.value;
        }
      } else if (field.type !== 'password') {
        formData[name] = field.value;
      }
    });

    return { formData, selector: this.generateSelector(form) };
  }

  // ==================== CSS E VALIDAÇÃO ====================

  handleExtractStyles(data) {
    const { selector, includeComputed = true, includeInline = true, includeClasses = true } = data || {};

    const element = selector ? document.querySelector(selector) : document.body;
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const result = {
      selector: selector || 'body',
      tagName: element.tagName.toLowerCase()
    };

    if (includeClasses) {
      result.classes = [...element.classList];
    }

    if (includeInline) {
      result.inlineStyles = element.getAttribute('style') || '';
      result.inlineStylesParsed = {};
      if (element.style.length > 0) {
        for (let i = 0; i < element.style.length; i++) {
          const prop = element.style[i];
          result.inlineStylesParsed[prop] = element.style.getPropertyValue(prop);
        }
      }
    }

    if (includeComputed) {
      const computed = window.getComputedStyle(element);
      result.computedStyles = {};

      const importantProps = [
        'display', 'position', 'width', 'height', 'margin', 'padding',
        'border', 'background', 'background-color', 'color', 'font-family',
        'font-size', 'font-weight', 'line-height', 'text-align', 'flex',
        'flex-direction', 'justify-content', 'align-items', 'grid',
        'gap', 'overflow', 'visibility', 'opacity', 'z-index',
        'box-shadow', 'border-radius', 'transform', 'transition'
      ];

      importantProps.forEach(prop => {
        const value = computed.getPropertyValue(prop);
        if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
          result.computedStyles[prop] = value;
        }
      });
    }

    if (!selector || selector === 'body' || selector === 'html') {
      result.stylesheetCount = document.styleSheets.length;
      result.externalStylesheets = [];

      for (const sheet of document.styleSheets) {
        if (sheet.href) {
          result.externalStylesheets.push(sheet.href);
        }
      }
    }

    return result;
  }

  handleExtractHtml(data) {
    const { selector, outerHtml = true } = data || {};

    const element = selector ? document.querySelector(selector) : document.documentElement;
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    return {
      selector: selector || 'html',
      html: outerHtml ? element.outerHTML : element.innerHTML,
      tagName: element.tagName.toLowerCase(),
      childCount: element.children.length
    };
  }

  handleValidatePage(data) {
    const { selector, rules = [] } = data || {};

    const container = selector ? document.querySelector(selector) : document.body;
    if (!container) {
      throw new Error(`Container not found: ${selector}`);
    }

    const results = {
      container: selector || 'body',
      timestamp: new Date().toISOString(),
      url: window.location.href,
      totalRules: rules.length,
      passed: 0,
      failed: 0,
      validations: []
    };

    if (rules.length === 0) {
      results.autoValidation = this.performAutoValidation(container);
      return results;
    }

    for (const rule of rules) {
      const validation = this.executeValidationRule(container, rule);
      results.validations.push(validation);

      if (validation.passed) {
        results.passed++;
      } else {
        results.failed++;
      }
    }

    results.success = results.failed === 0;
    return results;
  }

  executeValidationRule(container, rule) {
    const { type, selector, expected, property, description } = rule;

    const result = {
      type,
      selector,
      description: description || `${type}: ${selector}`,
      passed: false,
      actual: null,
      expected: expected
    };

    try {
      const elements = container.querySelectorAll(selector);
      const element = elements[0];

      switch (type) {
        case 'element_exists':
          result.actual = elements.length > 0;
          result.passed = result.actual === (expected !== false);
          break;

        case 'element_count':
          result.actual = elements.length;
          result.passed = elements.length === expected;
          break;

        case 'has_class':
          if (!element) {
            result.actual = null;
            result.passed = false;
          } else {
            result.actual = element.classList.contains(expected);
            result.passed = result.actual;
          }
          break;

        case 'has_style':
          if (!element) {
            result.actual = null;
            result.passed = false;
          } else {
            const computed = window.getComputedStyle(element);
            result.actual = computed.getPropertyValue(property);
            result.passed = result.actual === expected || result.actual.includes(expected);
          }
          break;

        case 'has_attribute':
          if (!element) {
            result.actual = null;
            result.passed = false;
          } else {
            result.actual = element.getAttribute(property);
            result.passed = expected === undefined
              ? element.hasAttribute(property)
              : result.actual === expected;
          }
          break;

        case 'text_contains':
          if (!element) {
            result.actual = null;
            result.passed = false;
          } else {
            result.actual = element.textContent?.trim().substring(0, 100);
            result.passed = element.textContent?.includes(expected) || false;
          }
          break;

        case 'text_equals':
          if (!element) {
            result.actual = null;
            result.passed = false;
          } else {
            result.actual = element.textContent?.trim();
            result.passed = result.actual === expected;
          }
          break;

        default:
          result.error = `Unknown validation type: ${type}`;
      }
    } catch (error) {
      result.error = error.message;
      result.passed = false;
    }

    return result;
  }

  performAutoValidation(container) {
    const issues = [];
    const info = {
      elements: {},
      accessibility: {},
      seo: {},
      performance: {}
    };

    info.elements = {
      total: container.querySelectorAll('*').length,
      forms: container.querySelectorAll('form').length,
      inputs: container.querySelectorAll('input, select, textarea').length,
      buttons: container.querySelectorAll('button, input[type="submit"]').length,
      links: container.querySelectorAll('a').length,
      images: container.querySelectorAll('img').length,
      tables: container.querySelectorAll('table').length,
      headings: {
        h1: container.querySelectorAll('h1').length,
        h2: container.querySelectorAll('h2').length,
        h3: container.querySelectorAll('h3').length
      }
    };

    const imagesWithoutAlt = container.querySelectorAll('img:not([alt])');
    if (imagesWithoutAlt.length > 0) {
      issues.push({
        type: 'accessibility',
        severity: 'warning',
        message: `${imagesWithoutAlt.length} imagem(ns) sem atributo alt`,
        elements: [...imagesWithoutAlt].map(el => this.generateSelector(el)).slice(0, 5)
      });
    }

    const inputsWithoutLabel = [];
    container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').forEach(input => {
      const hasLabel = input.id && container.querySelector(`label[for="${input.id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label');
      const hasPlaceholder = input.placeholder;
      const insideLabel = input.closest('label');

      if (!hasLabel && !hasAriaLabel && !insideLabel) {
        inputsWithoutLabel.push(input);
      }
    });

    if (inputsWithoutLabel.length > 0) {
      issues.push({
        type: 'accessibility',
        severity: 'warning',
        message: `${inputsWithoutLabel.length} campo(s) sem label associado`,
        elements: inputsWithoutLabel.map(el => this.generateSelector(el)).slice(0, 5)
      });
    }

    const formsWithoutAction = container.querySelectorAll('form:not([action])');
    if (formsWithoutAction.length > 0) {
      issues.push({
        type: 'form',
        severity: 'info',
        message: `${formsWithoutAction.length} formulário(s) sem atributo action`
      });
    }

    const brokenLinks = container.querySelectorAll('a:not([href]), a[href=""], a[href="#"]');
    if (brokenLinks.length > 0) {
      issues.push({
        type: 'seo',
        severity: 'warning',
        message: `${brokenLinks.length} link(s) sem href válido`
      });
    }

    if (info.elements.headings.h1 > 1) {
      issues.push({
        type: 'seo',
        severity: 'warning',
        message: `Página tem ${info.elements.headings.h1} tags H1 (recomendado: 1)`
      });
    }

    const inlineStyles = container.querySelectorAll('[style]');
    info.performance.inlineStyleCount = inlineStyles.length;
    if (inlineStyles.length > 10) {
      issues.push({
        type: 'performance',
        severity: 'info',
        message: `${inlineStyles.length} elementos com estilo inline (considere usar classes CSS)`
      });
    }

    container.querySelectorAll('table').forEach(table => {
      if (!table.querySelector('th') && !table.querySelector('thead')) {
        issues.push({
          type: 'accessibility',
          severity: 'warning',
          message: 'Tabela sem cabeçalho (th/thead)',
          elements: [this.generateSelector(table)]
        });
      }
    });

    info.accessibility.issueCount = issues.filter(i => i.type === 'accessibility').length;
    info.seo.issueCount = issues.filter(i => i.type === 'seo').length;

    return {
      score: Math.max(0, 100 - (issues.length * 5)),
      issueCount: issues.length,
      issues,
      info
    };
  }

  handleGetStylesheets() {
    const stylesheets = [];

    for (const sheet of document.styleSheets) {
      const sheetInfo = {
        href: sheet.href,
        type: sheet.type,
        disabled: sheet.disabled,
        title: sheet.title,
        media: sheet.media?.mediaText || 'all',
        isExternal: !!sheet.href,
        rulesCount: 0,
        rules: []
      };

      try {
        if (sheet.cssRules) {
          sheetInfo.rulesCount = sheet.cssRules.length;

          const sampleSize = Math.min(10, sheet.cssRules.length);
          for (let i = 0; i < sampleSize; i++) {
            const rule = sheet.cssRules[i];
            sheetInfo.rules.push({
              type: rule.type,
              selector: rule.selectorText || null,
              cssText: rule.cssText?.substring(0, 200)
            });
          }
        }
      } catch (e) {
        sheetInfo.accessError = 'Cannot access rules (CORS restriction)';
      }

      stylesheets.push(sheetInfo);
    }

    const inlineStyles = document.querySelectorAll('style');
    inlineStyles.forEach((style, index) => {
      stylesheets.push({
        href: null,
        type: 'inline',
        index,
        content: style.textContent?.substring(0, 500),
        contentLength: style.textContent?.length || 0
      });
    });

    return {
      total: stylesheets.length,
      external: stylesheets.filter(s => s.isExternal).length,
      inline: stylesheets.filter(s => s.type === 'inline').length,
      stylesheets
    };
  }

  // ==================== DIALOG HANDLERS ====================

  handleGetLastDialog() {
    return {
      dialog: this.lastDialog,
      autoAcceptEnabled: this.autoAcceptDialogs
    };
  }

  handleGetDialogQueue() {
    return {
      dialogs: this.dialogQueue,
      count: this.dialogQueue.length,
      autoAcceptEnabled: this.autoAcceptDialogs
    };
  }

  handleClearDialogQueue() {
    const count = this.dialogQueue.length;
    this.dialogQueue = [];
    this.lastDialog = null;
    return {
      cleared: true,
      count
    };
  }

  handleSetDialogAutoAccept(data) {
    const { enabled } = data;
    this.autoAcceptDialogs = enabled !== false;
    return {
      autoAcceptEnabled: this.autoAcceptDialogs
    };
  }

  // ==================== NOVAS FUNCIONALIDADES ====================

  /**
   * Pressiona uma tecla no teclado
   */
  async handlePressKey(data) {
    const { key, selector, modifiers = {} } = data;

    // Encontra o elemento alvo
    let element = document.activeElement;
    if (selector) {
      element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      element.focus();
    }

    // Mapeia teclas especiais para códigos
    const keyCodeMap = {
      'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
      'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
      'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
      'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
      'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      'Home': { key: 'Home', code: 'Home', keyCode: 36 },
      'End': { key: 'End', code: 'End', keyCode: 35 },
      'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
      'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      'Space': { key: ' ', code: 'Space', keyCode: 32 },
      ' ': { key: ' ', code: 'Space', keyCode: 32 }
    };

    const keyInfo = keyCodeMap[key] || { key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };

    const eventInit = {
      key: keyInfo.key,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      which: keyInfo.keyCode,
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers.ctrl || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      metaKey: modifiers.meta || false
    };

    // Dispara eventos de teclado
    element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    element.dispatchEvent(new KeyboardEvent('keypress', eventInit));

    await this.delay(50);

    element.dispatchEvent(new KeyboardEvent('keyup', eventInit));

    return {
      pressed: true,
      key: keyInfo.key,
      code: keyInfo.code,
      targetElement: this.generateSelector(element),
      modifiers
    };
  }

  /**
   * Retorna informações detalhadas de um elemento
   */
  handleGetElementInfo(data) {
    const { selector } = data;

    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);

    return {
      selector,
      found: true,
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: element.className || null,
      name: element.name || null,
      type: element.type || null,
      value: element.value || null,
      text: element.textContent?.trim().substring(0, 500) || null,
      innerText: element.innerText?.trim().substring(0, 500) || null,
      placeholder: element.placeholder || null,
      href: element.href || null,
      src: element.src || null,
      alt: element.alt || null,
      title: element.title || null,

      // Atributos data-*
      dataAttributes: this.getDataAttributes(element),

      // Atributos ARIA
      ariaLabel: element.getAttribute('aria-label'),
      ariaRole: element.getAttribute('role'),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaSelected: element.getAttribute('aria-selected'),
      ariaHidden: element.getAttribute('aria-hidden'),

      // Estados
      isVisible: this.isVisible(element),
      isEnabled: !element.disabled,
      isChecked: element.checked || false,
      isReadonly: element.readOnly || false,
      isFocused: document.activeElement === element,

      // Posição e tamanho
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft
      },

      // Estilos computados importantes
      styles: {
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
        position: computed.position,
        cursor: computed.cursor,
        backgroundColor: computed.backgroundColor,
        color: computed.color,
        fontSize: computed.fontSize
      },

      // Hierarquia
      parentSelector: element.parentElement ? this.generateSelector(element.parentElement) : null,
      childCount: element.children.length,

      // Seletores alternativos
      alternativeSelectors: this.generateAlternativeSelectors(element)
    };
  }

  /**
   * Retorna atributos data-* do elemento
   */
  getDataAttributes(element) {
    const dataAttrs = {};
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-')) {
        dataAttrs[attr.name] = attr.value;
      }
    }
    return dataAttrs;
  }

  /**
   * Gera seletores alternativos para um elemento
   */
  generateAlternativeSelectors(element) {
    const selectors = [];

    // Por ID
    if (element.id) {
      selectors.push(`#${element.id}`);
    }

    // Por data-testid
    if (element.getAttribute('data-testid')) {
      selectors.push(`[data-testid="${element.getAttribute('data-testid')}"]`);
    }

    // Por aria-label
    if (element.getAttribute('aria-label')) {
      selectors.push(`[aria-label="${element.getAttribute('aria-label')}"]`);
    }

    // Por name
    if (element.name) {
      selectors.push(`[name="${element.name}"]`);
    }

    // Por title
    if (element.title) {
      selectors.push(`[title="${element.title}"]`);
    }

    // Seletor CSS gerado
    selectors.push(this.generateSelector(element));

    return selectors;
  }

  /**
   * Clique duplo em um elemento
   */
  async handleDoubleClick(data) {
    const { selector, text } = data;

    let element = null;
    if (selector) {
      element = document.querySelector(selector);
    }
    if (!element && text) {
      element = this.findElementByText(text);
    }
    if (!element) {
      throw new Error(`Element not found: ${selector || text}`);
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(200);

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const mouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      detail: 2
    };

    element.dispatchEvent(new MouseEvent('mousedown', { ...mouseEventInit, detail: 1 }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...mouseEventInit, detail: 1 }));
    element.dispatchEvent(new MouseEvent('click', { ...mouseEventInit, detail: 1 }));
    element.dispatchEvent(new MouseEvent('mousedown', { ...mouseEventInit, detail: 2 }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...mouseEventInit, detail: 2 }));
    element.dispatchEvent(new MouseEvent('click', { ...mouseEventInit, detail: 2 }));
    element.dispatchEvent(new MouseEvent('dblclick', mouseEventInit));

    return {
      doubleClicked: true,
      selector: this.generateSelector(element)
    };
  }

  /**
   * Foca em um elemento
   */
  async handleFocusElement(data) {
    const { selector } = data;

    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100);

    if (element.focus) {
      element.focus();
    }

    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    return {
      focused: true,
      selector,
      isFocused: document.activeElement === element
    };
  }

  /**
   * Retorna informações do elemento atualmente focado
   */
  handleGetActiveElement() {
    const element = document.activeElement;

    if (!element || element === document.body) {
      return {
        hasActiveElement: false,
        message: 'No element is currently focused'
      };
    }

    return {
      hasActiveElement: true,
      tagName: element.tagName.toLowerCase(),
      selector: this.generateSelector(element),
      id: element.id || null,
      type: element.type || null,
      value: element.value || null,
      placeholder: element.placeholder || null
    };
  }

  /**
   * Executa JavaScript customizado na página
   * PODEROSO: Permite qualquer operação no contexto da página
   */
  async handleExecuteScript(data) {
    const { script, args = {} } = data;

    try {
      // Cria uma função com o script e executa
      // O script pode usar 'args' para acessar argumentos
      // e 'return' para retornar valores
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('args', script);

      const result = await fn(args);

      return {
        success: true,
        result: result !== undefined ? result : null,
        type: typeof result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      };
    }
  }

  // ==================== HELPERS ====================

  findField(selector, label) {
    if (selector) {
      const field = document.querySelector(selector);
      if (field) return field;
    }

    if (label) {
      return this.findFieldByLabel(label);
    }

    return null;
  }

  findFieldByLabel(label) {
    const labelLower = label.toLowerCase();

    const labels = [...document.querySelectorAll('label')];
    for (const labelEl of labels) {
      if (labelEl.textContent?.toLowerCase().includes(labelLower)) {
        if (labelEl.htmlFor) {
          const field = document.getElementById(labelEl.htmlFor);
          if (field) return field;
        }

        const field = labelEl.querySelector('input, select, textarea');
        if (field) return field;
      }
    }

    const byPlaceholder = document.querySelector(
      `input[placeholder*="${label}" i], textarea[placeholder*="${label}" i]`
    );
    if (byPlaceholder) return byPlaceholder;

    const byAria = document.querySelector(`[aria-label*="${label}" i]`);
    if (byAria) return byAria;

    const normalizedLabel = label.toLowerCase().replace(/\s+/g, '');
    const inputs = document.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
      const name = (input.name || '').toLowerCase().replace(/[_-]/g, '');
      if (name.includes(normalizedLabel)) return input;
    }

    return null;
  }

  findElementByText(text) {
    const textLower = text.toLowerCase().trim();

    // 1. Primeiro tenta botões e inputs (alta prioridade)
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
    for (const btn of buttons) {
      const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
      if (btnText.includes(textLower) && this.isVisible(btn)) return btn;
    }

    // 2. Tenta links
    const links = document.querySelectorAll('a');
    for (const link of links) {
      if (link.textContent?.toLowerCase().trim().includes(textLower) && this.isVisible(link)) return link;
    }

    // 3. Tenta elementos com onclick ou role
    const clickables = document.querySelectorAll('[onclick], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="listitem"]');
    for (const el of clickables) {
      if (el.textContent?.toLowerCase().trim().includes(textLower) && this.isVisible(el)) return el;
    }

    // 4. Tenta elementos com data-testid ou aria-label
    const dataElements = document.querySelectorAll('[data-testid], [aria-label]');
    for (const el of dataElements) {
      const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
      const testId = el.getAttribute('data-testid')?.toLowerCase() || '';
      if ((ariaLabel.includes(textLower) || testId.includes(textLower)) && this.isVisible(el)) return el;
    }

    // 5. Busca em spans e divs com título
    const titledElements = document.querySelectorAll('[title]');
    for (const el of titledElements) {
      if (el.getAttribute('title')?.toLowerCase().includes(textLower) && this.isVisible(el)) {
        // Retorna o elemento clicável mais próximo
        return this.findClickableParent(el) || el;
      }
    }

    // 6. Último recurso: busca em qualquer elemento visível (mais específico primeiro)
    const allElements = [...document.querySelectorAll('div, span, li, td, p, label')];

    // Ordena por profundidade (elementos mais internos primeiro)
    allElements.sort((a, b) => {
      const depthA = this.getElementDepth(a);
      const depthB = this.getElementDepth(b);
      return depthB - depthA;
    });

    for (const el of allElements) {
      if (!this.isVisible(el)) continue;

      // Verifica se o texto do elemento (não dos filhos) contém o texto buscado
      const directText = this.getDirectTextContent(el).toLowerCase().trim();
      if (directText.includes(textLower)) {
        // Retorna o elemento clicável mais próximo, ou o próprio elemento
        return this.findClickableParent(el) || el;
      }
    }

    return null;
  }

  /**
   * Retorna a profundidade do elemento no DOM
   */
  getElementDepth(element) {
    let depth = 0;
    let current = element;
    while (current.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  /**
   * Retorna apenas o texto direto do elemento, sem o texto dos filhos
   */
  getDirectTextContent(element) {
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text;
  }

  /**
   * Encontra o elemento clicável mais próximo (pai)
   */
  findClickableParent(element) {
    const clickableSelectors = [
      'button', 'a', '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="option"]', '[role="listitem"]', '[onclick]', '[data-testid]',
      '[tabindex="0"]', '[tabindex="-1"]'
    ].join(', ');

    return element.closest(clickableSelectors);
  }

  /**
   * Retorna lista de elementos clicáveis na página
   */
  getClickableElements() {
    const clickables = [];
    const seen = new Set();

    const selectors = [
      'button', 'a[href]', 'input[type="submit"]', 'input[type="button"]',
      '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="option"]',
      '[role="listitem"]', '[onclick]', '[tabindex="0"]', '[data-testid]'
    ];

    document.querySelectorAll(selectors.join(', ')).forEach(el => {
      if (!this.isVisible(el)) return;

      const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
      const key = `${text}-${el.tagName}-${el.className}`;

      if (seen.has(key) || !text) return;
      seen.add(key);

      clickables.push({
        text: text.substring(0, 100),
        tagName: el.tagName.toLowerCase(),
        type: el.type || el.getAttribute('role') || 'element',
        selector: this.generateSelector(el),
        id: el.id || null,
        testId: el.getAttribute('data-testid') || null,
        ariaLabel: el.getAttribute('aria-label') || null
      });
    });

    return clickables.slice(0, 100);
  }

  findLabelForField(field) {
    if (field.id) {
      const label = document.querySelector(`label[for="${field.id}"]`);
      if (label) return label.textContent?.trim();
    }

    const parent = field.closest('label');
    if (parent) {
      return parent.textContent?.replace(field.value || '', '').trim();
    }

    if (field.getAttribute('aria-label')) {
      return field.getAttribute('aria-label');
    }

    if (field.placeholder) {
      return field.placeholder;
    }

    return field.name || field.id || null;
  }

  async fillFieldValue(field, value) {
    field.focus();
    await this.delay(50);

    field.value = '';

    const descriptor = Object.getOwnPropertyDescriptor(
      field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    );
    if (descriptor?.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    field.blur();
  }

  generateSelector(element) {
    if (!element) return null;

    if (element.id) {
      return `#${element.id}`;
    }

    if (element.name) {
      return `[name="${element.name}"]`;
    }

    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c && !c.includes(':'));
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }

      const siblings = current.parentElement?.querySelectorAll(`:scope > ${current.tagName.toLowerCase()}`);
      if (siblings && siblings.length > 1) {
        const index = [...siblings].indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }

      path.unshift(selector);
      current = current.parentElement;

      if (path.length > 4) break;
    }

    return path.join(' > ');
  }

  isVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           element.offsetParent !== null;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Inicializa quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new UniversalBrowserBridge());
} else {
  new UniversalBrowserBridge();
}
