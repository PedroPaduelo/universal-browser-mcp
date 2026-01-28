/**
 * Utilitários de manipulação do DOM
 */

/**
 * Verifica se um elemento está visível
 */
export function isVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  return style.display !== 'none' &&
         style.visibility !== 'hidden' &&
         style.opacity !== '0' &&
         element.offsetParent !== null;
}

/**
 * Retorna a profundidade do elemento no DOM
 */
export function getElementDepth(element) {
  let depth = 0;
  let current = element;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

/**
 * Retorna apenas o texto direto do elemento, sem o texto dos filhos
 */
export function getDirectTextContent(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    }
  }
  return text;
}

/**
 * Retorna atributos data-* do elemento
 */
export function getDataAttributes(element) {
  const dataAttrs = {};
  for (const attr of element.attributes) {
    if (attr.name.startsWith('data-')) {
      dataAttrs[attr.name] = attr.value;
    }
  }
  return dataAttrs;
}

/**
 * Encontra o elemento clicável mais próximo (pai)
 */
export function findClickableParent(element) {
  const clickableSelectors = [
    'button', 'a', '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="option"]', '[role="listitem"]', '[onclick]', '[data-testid]',
    '[tabindex="0"]', '[tabindex="-1"]'
  ].join(', ');

  return element.closest(clickableSelectors);
}

/**
 * Promise-based delay
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
