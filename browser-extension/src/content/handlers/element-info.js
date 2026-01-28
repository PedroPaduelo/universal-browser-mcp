/**
 * Handler para informações detalhadas de elementos
 */

import { generateSelector, generateAlternativeSelectors } from '../utils/selectors.js';
import { isVisible, getDataAttributes } from '../utils/dom.js';

/**
 * Handler para obter informações detalhadas de um elemento
 */
export function handleGetElementInfo(data) {
  const { selector } = data;

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  const rect = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);

  return {
    selector,
    found: true,
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    className: element.className || null,
    name: element.name || null,
    type: element.type || null,
    value: element.value || null,
    text: element.textContent?.trim().substring(0, 500) || null,
    innerText: element.innerText?.trim().substring(0, 500) || null,
    placeholder: element.placeholder || null,
    href: element.href || null,
    src: element.src || null,
    alt: element.alt || null,
    title: element.title || null,

    // Atributos data-*
    dataAttributes: getDataAttributes(element),

    // Atributos ARIA
    ariaLabel: element.getAttribute('aria-label'),
    ariaRole: element.getAttribute('role'),
    ariaExpanded: element.getAttribute('aria-expanded'),
    ariaSelected: element.getAttribute('aria-selected'),
    ariaHidden: element.getAttribute('aria-hidden'),

    // Estados
    isVisible: isVisible(element),
    isEnabled: !element.disabled,
    isChecked: element.checked || false,
    isReadonly: element.readOnly || false,
    isFocused: document.activeElement === element,

    // Posição e tamanho
    position: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft
    },

    // Estilos computados importantes
    styles: {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      position: computed.position,
      cursor: computed.cursor,
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      fontSize: computed.fontSize
    },

    // Hierarquia
    parentSelector: element.parentElement ? generateSelector(element.parentElement) : null,
    childCount: element.children.length,

    // Seletores alternativos
    alternativeSelectors: generateAlternativeSelectors(element)
  };
}
