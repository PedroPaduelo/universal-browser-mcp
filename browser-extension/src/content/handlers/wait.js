/**
 * Handlers de espera
 */

import { isVisible, delay } from '../utils/dom.js';

/**
 * Handler para esperar elemento
 */
export async function handleWaitForElement(data) {
  const { selector, timeout = 10000 } = data;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) {
      return {
        found: true,
        selector,
        waitTime: Date.now() - startTime
      };
    }
    await delay(200);
  }

  throw new Error(`Timeout waiting for element: ${selector}`);
}

/**
 * Handler para esperar texto
 */
export async function handleWaitForText(data) {
  const { text, selector, timeout = 10000 } = data;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = selector ? document.querySelector(selector) : document.body;
    if (element && element.innerText?.includes(text)) {
      return {
        found: true,
        text,
        waitTime: Date.now() - startTime
      };
    }
    await delay(200);
  }

  throw new Error(`Timeout waiting for text: ${text}`);
}
