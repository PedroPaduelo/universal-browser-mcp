/**
 * Page ready and retry action handlers
 * Provides page readiness detection and action retry logic
 */

import { delay } from '../../utils/dom.js';
import { handleSmartWait } from '../smart-wait.js';

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
  const { handleBatchActions } = await import('../batch.js');

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
