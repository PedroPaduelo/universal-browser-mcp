/**
 * Universal Browser MCP - Content Script Entry Point
 */

import { UniversalBrowserBridge } from './bridge.js';

// Inicializa quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new UniversalBrowserBridge());
} else {
  new UniversalBrowserBridge();
}
