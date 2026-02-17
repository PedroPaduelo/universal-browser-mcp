/**
 * Smart wait handlers - Intelligent waiting with multiple conditions
 */

import { conditionCheckers } from './smart-wait/wait-conditions.js';

export { handlePageReady, handleRetryAction } from './smart-wait/page-ready.js';

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
