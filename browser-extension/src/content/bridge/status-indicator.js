/**
 * Status indicator UI for automation tab
 */

const STATUS_STATES = {
  connecting: { bg: '#f59e0b', emoji: '\uD83D\uDD04', title: 'Conectando...' },
  connected: { bg: '#22c55e', emoji: '\uD83E\uDD16', title: 'Conectado' },
  disconnected: { bg: '#ef4444', emoji: '\u274C', title: 'Desconectado' },
  processing: { bg: '#3b82f6', emoji: '\u2699\uFE0F', title: 'Processando...' },
  error: { bg: '#dc2626', emoji: '\u26A0\uFE0F', title: 'Erro' }
};

/**
 * Create the status indicator DOM element
 */
export function createStatusIndicator(sessionId, onDebugClick) {
  if (document.getElementById('mcp-universal-status')) {
    return document.getElementById('mcp-universal-status');
  }

  const indicator = document.createElement('div');
  indicator.id = 'mcp-universal-status';
  indicator.innerHTML = '\uD83E\uDD16';
  indicator.style.cssText = `
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

  indicator.addEventListener('click', onDebugClick);

  const appendIndicator = () => {
    if (document.body) {
      document.body.appendChild(indicator);
    } else {
      requestAnimationFrame(appendIndicator);
    }
  };
  appendIndicator();

  return indicator;
}

/**
 * Update the status indicator visual state
 */
export function updateStatusIndicator(indicator, status, sessionId) {
  if (!indicator) return;

  const state = STATUS_STATES[status] || STATUS_STATES.disconnected;
  indicator.style.background = state.bg;
  indicator.innerHTML = state.emoji;
  indicator.title = `[${sessionId}] ${state.title}`;
}
