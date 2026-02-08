/**
 * Dialog handlers (alert, confirm, prompt)
 * Intercepts native dialogs with restore capability
 */

let lastDialog = null;
let dialogQueue = [];
let autoAcceptDialogs = true;

// Store original functions for restoration
let originalAlert = null;
let originalConfirm = null;
let originalPrompt = null;
let isIntercepting = false;

/**
 * Intercept native dialogs
 */
export function interceptDialogs(sessionId, sendMessage) {
  if (isIntercepting) return;
  isIntercepting = true;

  originalAlert = window.alert.bind(window);
  originalConfirm = window.confirm.bind(window);
  originalPrompt = window.prompt.bind(window);

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
 * Stop intercepting dialogs and restore original functions
 */
export function stopInterceptingDialogs() {
  if (!isIntercepting) return;

  if (originalAlert) window.alert = originalAlert;
  if (originalConfirm) window.confirm = originalConfirm;
  if (originalPrompt) window.prompt = originalPrompt;

  originalAlert = null;
  originalConfirm = null;
  originalPrompt = null;
  isIntercepting = false;

  console.log('[Universal MCP] Dialog interception disabled, originals restored');
}

/**
 * Handler for getting the last dialog
 */
export function handleGetLastDialog() {
  return {
    dialog: lastDialog,
    autoAcceptEnabled: autoAcceptDialogs
  };
}

/**
 * Handler for getting the dialog queue
 */
export function handleGetDialogQueue() {
  return {
    dialogs: dialogQueue,
    count: dialogQueue.length,
    autoAcceptEnabled: autoAcceptDialogs
  };
}

/**
 * Handler for clearing the dialog queue
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
 * Handler for configuring auto-accept
 */
export function handleSetDialogAutoAccept(data) {
  const { enabled } = data;
  autoAcceptDialogs = enabled !== false;
  return {
    autoAcceptEnabled: autoAcceptDialogs
  };
}
