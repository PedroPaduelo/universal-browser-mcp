/**
 * Universal Browser MCP - Background Service Worker
 * Entry point - Modularizado
 */

import { initKeepAlive } from './keep-alive.js';
import { connectToMCPServer } from './websocket-client.js';
import { initSessionListeners } from './session-manager.js';
import { initMessageListener } from './message-handler.js';
import { initDebuggerListeners } from './debugger/index.js';

console.log('[Universal MCP] Background script loading...');

/**
 * Inicializa todos os módulos
 */
function init() {
  console.log('[Universal MCP] Initializing modules...');

  // Inicializa keep-alive
  initKeepAlive();

  // Inicializa listeners de sessão
  initSessionListeners();

  // Inicializa listener de mensagens
  initMessageListener();

  // Inicializa listeners do debugger
  initDebuggerListeners();

  // Conecta ao MCP Server
  connectToMCPServer();

  console.log('[Universal MCP] All modules initialized!');
}

// Quando a extensão é instalada
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Universal MCP] Extension installed');
  init();
});

// Quando o service worker é ativado
chrome.runtime.onStartup.addListener(() => {
  console.log('[Universal MCP] Extension started');
  init();
});

// Inicializa imediatamente
init();
