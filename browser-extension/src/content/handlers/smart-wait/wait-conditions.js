/**
 * Smart wait condition checkers
 * Defines all condition type functions for smart waiting
 */

import { isVisible } from '../../utils/dom.js';

/**
 * Condition type checkers
 */
export const conditionCheckers = {
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
