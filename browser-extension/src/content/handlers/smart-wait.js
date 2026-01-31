/**
 * Smart wait handlers - Intelligent waiting with multiple conditions
 */

import { isVisible, delay } from '../utils/dom.js';

/**
 * Condition type checkers
 */
const conditionCheckers = {
  /**
   * Wait for element to be present and visible
   */
  element: async (config) => {
    const { selector } = config;
    const element = document.querySelector(selector);
    return element && isVisible(element);
  },

  /**
   * Wait for text to appear in page
   */
  text: async (config) => {
    const { text, selector } = config;
    const container = selector ? document.querySelector(selector) : document.body;
    if (!container) return false;
    return container.innerText?.includes(text);
  },

  /**
   * Wait for URL to contain specific string
   */
  url_contains: async (config) => {
    const { value } = config;
    return window.location.href.includes(value);
  },

  /**
   * Wait for URL to match exactly
   */
  url_equals: async (config) => {
    const { value } = config;
    return window.location.href === value;
  },

  /**
   * Wait for URL pattern (regex)
   */
  url_matches: async (config) => {
    const { pattern } = config;
    const regex = new RegExp(pattern);
    return regex.test(window.location.href);
  },

  /**
   * Wait for network to be idle (no pending requests for specified duration)
   * Note: This uses a simplified approach since we can't directly access network from content script
   */
  network_idle: async (config) => {
    const { duration = 500 } = config;
    // Check if page is still loading
    if (document.readyState !== 'complete') return false;

    // Use Performance API to check for recent network activity
    const entries = performance.getEntriesByType('resource');
    if (entries.length === 0) return true;

    const lastEntry = entries[entries.length - 1];
    const timeSinceLastResource = performance.now() - (lastEntry.responseEnd || lastEntry.startTime);

    return timeSinceLastResource >= duration;
  },

  /**
   * Wait for no loading spinners/indicators
   */
  no_loading_spinner: async (config) => {
    const { selector = '.loading, .spinner, [class*="loading"], [class*="spinner"], [aria-busy="true"]' } = config;

    const spinners = document.querySelectorAll(selector);
    for (const spinner of spinners) {
      if (isVisible(spinner)) {
        return false;
      }
    }
    return true;
  },

  /**
   * Wait for element to be hidden/removed
   */
  element_hidden: async (config) => {
    const { selector } = config;
    const element = document.querySelector(selector);
    return !element || !isVisible(element);
  },

  /**
   * Wait for element to be enabled (not disabled)
   */
  element_enabled: async (config) => {
    const { selector } = config;
    const element = document.querySelector(selector);
    return element && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  },

  /**
   * Wait for document ready state
   */
  document_ready: async (config) => {
    const { state = 'complete' } = config;
    return document.readyState === state;
  },

  /**
   * Wait for DOM to be stable (no mutations for specified duration)
   */
  dom_stable: async (config) => {
    const { duration = 500 } = config;

    return new Promise(resolve => {
      let timeout = null;
      let lastMutation = Date.now();

      const observer = new MutationObserver(() => {
        lastMutation = Date.now();
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, duration);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      // Initial timeout in case no mutations occur
      timeout = setTimeout(() => {
        observer.disconnect();
        resolve(true);
      }, duration);
    });
  },

  /**
   * Wait for element count
   */
  element_count: async (config) => {
    const { selector, count, operator = 'eq' } = config;
    const elements = document.querySelectorAll(selector);
    const actualCount = elements.length;

    switch (operator) {
      case 'eq': return actualCount === count;
      case 'gt': return actualCount > count;
      case 'gte': return actualCount >= count;
      case 'lt': return actualCount < count;
      case 'lte': return actualCount <= count;
      default: return actualCount === count;
    }
  },

  /**
   * Wait for element attribute value
   */
  attribute_equals: async (config) => {
    const { selector, attribute, value } = config;
    const element = document.querySelector(selector);
    if (!element) return false;
    return element.getAttribute(attribute) === value;
  },

  /**
   * Wait for element to have specific text
   */
  element_text: async (config) => {
    const { selector, text, exact = false } = config;
    const element = document.querySelector(selector);
    if (!element) return false;
    const elementText = element.textContent?.trim() || '';

    if (exact) {
      return elementText === text;
    }
    return elementText.includes(text);
  }
};

/**
 * Handler for smart wait with multiple conditions
 */
export async function handleSmartWait(data) {
  const { conditions, logic = 'all', timeout = 10000, pollInterval = 100 } = data;

  if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
    throw new Error('conditions array is required and must not be empty');
  }

  const startTime = Date.now();
  const results = {};

  // Initialize results
  for (let i = 0; i < conditions.length; i++) {
    results[i] = { type: conditions[i].type, satisfied: false };
  }

  const checkConditions = async () => {
    let satisfiedCount = 0;

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const { type } = condition;

      if (!conditionCheckers[type]) {
        throw new Error(`Unknown condition type: ${type}`);
      }

      try {
        const isSatisfied = await conditionCheckers[type](condition);
        results[i].satisfied = isSatisfied;
        if (isSatisfied) satisfiedCount++;
      } catch (error) {
        results[i].error = error.message;
      }
    }

    // Check if we're done based on logic
    if (logic === 'any') {
      return satisfiedCount > 0;
    } else {
      // 'all' is default
      return satisfiedCount === conditions.length;
    }
  };

  return new Promise(async (resolve, reject) => {
    // Immediate check
    if (await checkConditions()) {
      return resolve({
        success: true,
        waitTime: Date.now() - startTime,
        conditions: Object.values(results)
      });
    }

    let resolved = false;
    let observer = null;
    let timeoutId = null;
    let pollId = null;

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
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    const check = async () => {
      if (resolved) return;

      if (await checkConditions()) {
        cleanup();
        resolve({
          success: true,
          waitTime: Date.now() - startTime,
          conditions: Object.values(results)
        });
        return true;
      }
      return false;
    };

    // Timeout
    timeoutId = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error(`Smart wait timeout (${timeout}ms). Conditions: ${JSON.stringify(Object.values(results))}`));
      }
    }, timeout);

    // MutationObserver for DOM-related conditions
    const hasDomConditions = conditions.some(c =>
      ['element', 'element_hidden', 'element_enabled', 'element_count', 'element_text', 'attribute_equals', 'text'].includes(c.type)
    );

    if (hasDomConditions) {
      try {
        observer = new MutationObserver(async () => {
          await check();
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      } catch (e) {
        console.warn('[smart-wait] MutationObserver failed:', e);
      }
    }

    // Polling as fallback
    pollId = setInterval(async () => {
      await check();
    }, pollInterval);
  });
}

/**
 * Handler for page ready - wait for page to be fully loaded and interactive
 */
export async function handlePageReady(data = {}) {
  const { timeout = 30000, checkNetwork = true, checkSpinners = true, stabilityDuration = 500 } = data;

  const conditions = [
    { type: 'document_ready', state: 'complete' }
  ];

  if (checkSpinners) {
    conditions.push({ type: 'no_loading_spinner' });
  }

  if (checkNetwork) {
    conditions.push({ type: 'network_idle', duration: stabilityDuration });
  }

  conditions.push({ type: 'dom_stable', duration: stabilityDuration });

  try {
    const result = await handleSmartWait({
      conditions,
      logic: 'all',
      timeout,
      pollInterval: 200
    });

    return {
      ready: true,
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      waitTime: result.waitTime
    };
  } catch (error) {
    // Return partial result on timeout
    return {
      ready: false,
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      error: error.message
    };
  }
}

/**
 * Handler for retry action - execute action with automatic retry on failure
 */
export async function handleRetryAction(data) {
  const { action, maxAttempts = 3, delayMs = 1000, backoff = false } = data;

  if (!action || !action.type) {
    throw new Error('action with type is required');
  }

  // Import handlers dynamically to avoid circular dependencies
  const { handleBatchActions } = await import('./batch.js');

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await handleBatchActions({
        actions: [action],
        stopOnError: true
      });

      if (result.completed && result.results[0]?.success) {
        return {
          success: true,
          attempts: attempt,
          result: result.results[0].data
        };
      }

      lastError = new Error(result.results[0]?.error || 'Action failed');
    } catch (error) {
      lastError = error;
    }

    // Wait before retry (with optional exponential backoff)
    if (attempt < maxAttempts) {
      const waitTime = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
      await delay(waitTime);
    }
  }

  return {
    success: false,
    attempts: maxAttempts,
    error: lastError?.message || 'Max attempts reached'
  };
}
