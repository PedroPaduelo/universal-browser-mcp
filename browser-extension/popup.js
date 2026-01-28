/**
 * Universal Browser MCP - Popup Script v2.0
 * Gerencia sessões de automação isoladas
 */

document.addEventListener('DOMContentLoaded', () => {
  checkStatus();

  document.getElementById('refresh-btn').addEventListener('click', checkStatus);
  document.getElementById('create-session-btn').addEventListener('click', createSession);
  document.getElementById('close-all-btn').addEventListener('click', closeAllSessions);
});

async function checkStatus() {
  const serverDot = document.getElementById('server-dot');
  const serverStatus = document.getElementById('server-status');
  const sessionsCount = document.getElementById('sessions-count');
  const sessionList = document.getElementById('session-list');
  const closeAllBtn = document.getElementById('close-all-btn');

  // Reset to checking state
  serverDot.className = 'status-dot checking';
  serverStatus.textContent = 'Verificando...';

  // Check WebSocket server
  const wsConnected = await checkWebSocketServer();
  if (wsConnected) {
    serverDot.className = 'status-dot connected';
    serverStatus.textContent = 'Conectado';
  } else {
    serverDot.className = 'status-dot';
    serverStatus.textContent = 'Desconectado';
  }

  // Get sessions from background
  chrome.runtime.sendMessage({ type: 'list_automation_sessions' }, (response) => {
    const sessions = response?.sessions || [];
    sessionsCount.textContent = sessions.length;

    if (sessions.length === 0) {
      sessionList.innerHTML = '<p class="no-sessions">Nenhuma sessão ativa</p>';
      closeAllBtn.disabled = true;
    } else {
      closeAllBtn.disabled = false;
      sessionList.innerHTML = sessions.map(s => `
        <div class="session-item">
          <span class="session-id">${s.sessionId}</span>
          <span class="session-url">Window: ${s.windowId}</span>
        </div>
      `).join('');
    }
  });
}

async function createSession() {
  const urlInput = document.getElementById('initial-url');
  const url = urlInput.value.trim() || 'about:blank';
  const createBtn = document.getElementById('create-session-btn');

  // Gera um sessionId único
  const sessionId = 'session_' + Math.random().toString(36).substr(2, 8);

  createBtn.disabled = true;
  createBtn.textContent = '⏳ Criando...';

  try {
    // Envia mensagem para o background criar a sessão
    chrome.runtime.sendMessage({
      type: 'create_automation_session',
      sessionId: sessionId,
      url: url
    }, (response) => {
      if (response?.success) {
        urlInput.value = '';
        showNotification('Sessão criada: ' + sessionId);
      } else {
        showNotification('Erro: ' + (response?.error || 'Falha ao criar sessão'));
      }

      createBtn.disabled = false;
      createBtn.textContent = '✨ Criar Nova Sessão de Automação';

      // Atualiza o status
      setTimeout(checkStatus, 500);
    });
  } catch (error) {
    showNotification('Erro: ' + error.message);
    createBtn.disabled = false;
    createBtn.textContent = '✨ Criar Nova Sessão de Automação';
  }
}

async function closeAllSessions() {
  const closeBtn = document.getElementById('close-all-btn');

  if (!confirm('Fechar todas as sessões de automação?')) {
    return;
  }

  closeBtn.disabled = true;
  closeBtn.textContent = '⏳ Fechando...';

  // Pega lista de sessões
  chrome.runtime.sendMessage({ type: 'list_automation_sessions' }, async (response) => {
    const sessions = response?.sessions || [];

    // Fecha cada sessão
    for (const session of sessions) {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'close_automation_session',
          sessionId: session.sessionId
        }, resolve);
      });
    }

    closeBtn.textContent = '🗑️ Fechar Todas';
    checkStatus();
  });
}

function checkWebSocketServer() {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket('ws://localhost:3002');
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    } catch (error) {
      resolve(false);
    }
  });
}

function showNotification(message) {
  // Cria notificação temporária
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    right: 16px;
    background: #334155;
    color: white;
    padding: 12px;
    border-radius: 8px;
    font-size: 12px;
    z-index: 1000;
    animation: slideUp 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Adiciona animação CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(style);
