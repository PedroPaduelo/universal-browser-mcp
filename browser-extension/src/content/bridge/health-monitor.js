/**
 * Health check monitor for automation connection
 */

const HEALTH_CHECK_INTERVAL = 30000;

/**
 * Start periodic health checks
 * Returns interval ID for cleanup
 */
export function startHealthCheck(sessionId, sendMessage) {
  return setInterval(() => {
    sendMessage({
      type: 'health_check',
      sessionId,
      data: { url: window.location.href }
    });
  }, HEALTH_CHECK_INTERVAL);
}
