/**
 * Handlers de espera - Versão otimizada com MutationObserver
 */

import { isVisible, delay } from '../utils/dom.js';

/**
 * Handler para esperar elemento - usa MutationObserver para melhor performance
 * Max timeout capped at 60s to prevent indefinite blocking
 */
export async function handleWaitForElement(data) {
  const { selector, timeout = 10000 } = data;
  // Cap timeout at 60 seconds to prevent long blocks
  const effectiveTimeout = Math.min(timeout, 60000);
  const startTime = Date.now();

  // Verificação imediata
  const existingElement = document.querySelector(selector);
  if (existingElement && isVisible(existingElement)) {
    return {
      found: true,
      selector,
      waitTime: 0
    };
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    let observer = null;
    let timeoutId = null;
    let pollIntervalId = null;

    const cleanup = () => {
      resolved = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const checkElement = () => {
      if (resolved) return false;

      try {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) {
          cleanup();
          resolve({
            found: true,
            selector,
            waitTime: Date.now() - startTime
          });
          return true;
        }
      } catch (err) {
        // Selector inválido
        cleanup();
        reject(new Error(`Invalid selector: ${selector}`));
        return true;
      }
      return false;
    };

    // Timeout principal - garante que sempre retorna
    timeoutId = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error(`Timeout (${effectiveTimeout}ms) waiting for element: ${selector}`));
      }
    }, effectiveTimeout);

    // MutationObserver para detectar mudanças no DOM
    try {
      observer = new MutationObserver((mutations) => {
        if (!resolved) {
          checkElement();
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
    } catch (err) {
      console.warn('[wait] MutationObserver failed, using polling only:', err);
    }

    // Polling de backup (caso MutationObserver perca algo)
    // Intervalo mais curto no início, depois aumenta
    let pollCount = 0;
    pollIntervalId = setInterval(() => {
      if (!resolved) {
        pollCount++;
        checkElement();

        // Após 10 polls (1s), aumenta intervalo para 500ms
        if (pollCount === 10 && pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = setInterval(() => {
            if (!resolved) checkElement();
          }, 500);
        }
      }
    }, 100);
  });
}

/**
 * Handler para esperar texto - usa MutationObserver para melhor performance
 * Max timeout capped at 60s to prevent indefinite blocking
 */
export async function handleWaitForText(data) {
  const { text, selector, timeout = 10000 } = data;
  // Cap timeout at 60 seconds to prevent long blocks
  const effectiveTimeout = Math.min(timeout, 60000);
  const startTime = Date.now();

  // Verificação imediata
  const container = selector ? document.querySelector(selector) : document.body;
  if (container && container.innerText?.includes(text)) {
    return {
      found: true,
      text,
      waitTime: 0
    };
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    let observer = null;
    let timeoutId = null;
    let pollIntervalId = null;

    const cleanup = () => {
      resolved = true;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    };

    const checkText = () => {
      if (resolved) return false;

      try {
        const element = selector ? document.querySelector(selector) : document.body;
        if (element && element.innerText?.includes(text)) {
          cleanup();
          resolve({
            found: true,
            text,
            waitTime: Date.now() - startTime
          });
          return true;
        }
      } catch (err) {
        cleanup();
        reject(new Error(`Error checking text: ${err.message}`));
        return true;
      }
      return false;
    };

    // Timeout principal
    timeoutId = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error(`Timeout (${effectiveTimeout}ms) waiting for text: ${text}`));
      }
    }, effectiveTimeout);

    // MutationObserver
    try {
      const observeTarget = selector ? document.querySelector(selector) : document.body;
      if (observeTarget) {
        observer = new MutationObserver(() => {
          if (!resolved) checkText();
        });

        observer.observe(observeTarget, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    } catch (err) {
      console.warn('[wait] MutationObserver failed:', err);
    }

    // Polling de backup
    let pollCount = 0;
    pollIntervalId = setInterval(() => {
      if (!resolved) {
        pollCount++;
        checkText();

        if (pollCount === 10 && pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = setInterval(() => {
            if (!resolved) checkText();
          }, 500);
        }
      }
    }, 100);
  });
}
