/**
 * Script execution handler with security sandboxing
 */

const MAX_SCRIPT_SIZE = 10240; // 10KB max
const EXECUTION_TIMEOUT = 5000; // 5 second timeout

/**
 * Blocked API patterns that should not be used in scripts
 */
const BLOCKED_PATTERNS = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bimportScripts\s*\(/,
  /\bnew\s+Worker\s*\(/,
  /\bnew\s+SharedWorker\s*\(/,
  /\bchrome\s*\.\s*(?:runtime|extension|tabs|storage|webRequest)/,
  /\bfetch\s*\(\s*['"]chrome-extension:\/\//,
  /\b__proto__\s*=/,
  /\bconstructor\s*\[\s*['"]constructor['"]\s*\]/,
];

/**
 * Validate a script before execution
 */
function validateScript(script) {
  if (!script || typeof script !== 'string') {
    throw new Error('Script must be a non-empty string');
  }

  if (script.length > MAX_SCRIPT_SIZE) {
    throw new Error(`Script exceeds maximum size of ${MAX_SCRIPT_SIZE} bytes (got ${script.length})`);
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(script)) {
      throw new Error(`Script contains blocked API pattern: ${pattern.source}`);
    }
  }
}

/**
 * Execute a script with timeout protection
 */
async function executeWithTimeout(fn, args, timeoutMs) {
  return Promise.race([
    fn(args),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Script execution timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Handler for executing custom JavaScript in the page
 */
export async function handleExecuteScript(data) {
  const { script, args = {} } = data;

  try {
    validateScript(script);

    // Wrap in strict mode for added safety
    const wrappedScript = `'use strict';\n${script}`;
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('args', wrappedScript);

    const result = await executeWithTimeout(fn, args, EXECUTION_TIMEOUT);

    return {
      success: true,
      result: result !== undefined ? result : null,
      type: typeof result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    };
  }
}
