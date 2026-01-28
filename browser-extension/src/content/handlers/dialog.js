/**
 * Handlers de diálogos (alert, confirm, prompt)
 */

/**
 * Estado dos diálogos
 */
let lastDialog = null;
let dialogQueue = [];
let autoAcceptDialogs = true;

/**
 * Intercepta diálogos nativos
 */
export function interceptDialogs(sessionId, sendMessage) {
  const originalAlert = window.alert.bind(window);
  const originalConfirm = window.confirm.bind(window);
  const originalPrompt = window.prompt.bind(window);

  window.alert = function(message) {
    console.log('[Universal MCP] Alert intercepted:', message);
    lastDialog = {
      type: 'alert',
      message: String(message),
      timestamp: Date.now()
    };
    dialogQueue.push(lastDialog);

    sendMessage({
      type: 'dialog_opened',
      sessionId,
      data: lastDialog
    });

    if (autoAcceptDialogs) {
      return undefined;
    }
    return originalAlert(message);
  };

  window.confirm = function(message) {
    console.log('[Universal MCP] Confirm intercepted:', message);
    lastDialog = {
      type: 'confirm',
      message: String(message),
      timestamp: Date.now()
    };
    dialogQueue.push(lastDialog);

    sendMessage({
      type: 'dialog_opened',
      sessionId,
      data: lastDialog
    });

    if (autoAcceptDialogs) {
      lastDialog.result = true;
      return true;
    }
    const result = originalConfirm(message);
    lastDialog.result = result;
    return result;
  };

  window.prompt = function(message, defaultValue) {
    console.log('[Universal MCP] Prompt intercepted:', message);
    lastDialog = {
      type: 'prompt',
      message: String(message),
      defaultValue: defaultValue || '',
      timestamp: Date.now()
    };
    dialogQueue.push(lastDialog);

    sendMessage({
      type: 'dialog_opened',
      sessionId,
      data: lastDialog
    });

    if (autoAcceptDialogs) {
      lastDialog.result = defaultValue || '';
      return defaultValue || '';
    }
    const result = originalPrompt(message, defaultValue);
    lastDialog.result = result;
    return result;
  };

  console.log('[Universal MCP] Dialog interception enabled');
}

/**
 * Handler para obter último diálogo
 */
export function handleGetLastDialog() {
  return {
    dialog: lastDialog,
    autoAcceptEnabled: autoAcceptDialogs
  };
}

/**
 * Handler para obter fila de diálogos
 */
export function handleGetDialogQueue() {
  return {
    dialogs: dialogQueue,
    count: dialogQueue.length,
    autoAcceptEnabled: autoAcceptDialogs
  };
}

/**
 * Handler para limpar fila de diálogos
 */
export function handleClearDialogQueue() {
  const count = dialogQueue.length;
  dialogQueue = [];
  lastDialog = null;
  return {
    cleared: true,
    count
  };
}

/**
 * Handler para configurar auto-aceite
 */
export function handleSetDialogAutoAccept(data) {
  const { enabled } = data;
  autoAcceptDialogs = enabled !== false;
  return {
    autoAcceptEnabled: autoAcceptDialogs
  };
}
