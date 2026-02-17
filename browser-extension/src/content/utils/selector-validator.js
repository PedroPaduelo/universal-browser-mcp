/**
 * CSS Selector validation utility
 * Validates selectors before use to prevent injection attacks
 */

const MAX_SELECTOR_LENGTH = 500;

/**
 * Patterns that should never appear in CSS selectors
 */
const DANGEROUS_PATTERNS = [
  /<script/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*javascript/i,
  /-moz-binding/i,
];

/**
 * Validate a CSS selector for safety and correctness
 * @param {string} selector - CSS selector to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
export function validateCssSelector(selector) {
  if (!selector || typeof selector !== 'string') {
    return { valid: false, error: 'Selector must be a non-empty string' };
  }

  if (selector.length > MAX_SELECTOR_LENGTH) {
    return { valid: false, error: `Selector exceeds maximum length of ${MAX_SELECTOR_LENGTH} characters` };
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(selector)) {
      return { valid: false, error: `Selector contains potentially dangerous pattern: ${pattern.source}` };
    }
  }

  // Verify the selector is syntactically valid by trying to use it
  try {
    document.querySelector(selector);
  } catch (e) {
    return { valid: false, error: `Invalid CSS selector syntax: ${e.message}` };
  }

  return { valid: true };
}

/**
 * Validate and query a selector, throwing on invalid input
 * @param {string} selector - CSS selector
 * @returns {Element|null} The matched element or null
 */
export function safeQuerySelector(selector) {
  const validation = validateCssSelector(selector);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return document.querySelector(selector);
}

/**
 * Validate and query all matching elements
 * @param {string} selector - CSS selector
 * @returns {NodeList} Matching elements
 */
export function safeQuerySelectorAll(selector) {
  const validation = validateCssSelector(selector);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  return document.querySelectorAll(selector);
}
