/**
 * Handlers de interação com elementos
 */

import { generateSelector, findField, findElementByText } from '../utils/selectors.js';
import { findClickableParent, delay } from '../utils/dom.js';
import { simulateMouseClick, simulateDoubleClick, simulateHover, simulateKeyPress, fillFieldValue, typeText } from '../utils/events.js';

/**
 * Handler para clicar em elemento
 */
export async function handleClickElement(data) {
  const { selector, text, clickParent = true } = data;

  let element = null;

  if (selector) {
    element = document.querySelector(selector);
  }

  if (!element && text) {
    element = findElementByText(text);
  }

  if (!element) {
    throw new Error(`Element not found: ${selector || text}`);
  }

  let targetElement = element;
  if (clickParent) {
    const clickableParent = findClickableParent(element);
    if (clickableParent && clickableParent !== document.body) {
      targetElement = clickableParent;
    }
  }

  targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(200);

  if (targetElement.focus) {
    targetElement.focus();
  }

  await simulateMouseClick(targetElement);

  return {
    clicked: true,
    selector: generateSelector(targetElement),
    text: (targetElement.textContent || targetElement.value || '').trim().substring(0, 100),
    usedParent: targetElement !== element
  };
}

/**
 * Handler para duplo clique
 */
export async function handleDoubleClick(data) {
  const { selector, text } = data;

  let element = null;
  if (selector) {
    element = document.querySelector(selector);
  }
  if (!element && text) {
    element = findElementByText(text);
  }
  if (!element) {
    throw new Error(`Element not found: ${selector || text}`);
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(200);

  await simulateDoubleClick(element);

  return {
    doubleClicked: true,
    selector: generateSelector(element)
  };
}

/**
 * Handler para hover
 */
export async function handleHoverElement(data) {
  const { selector } = data;

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  simulateHover(element);

  return { hovered: true, selector };
}

/**
 * Handler para pressionar tecla
 */
export async function handlePressKey(data) {
  const { key, selector, modifiers = {} } = data;

  let element = document.activeElement;
  if (selector) {
    element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    element.focus();
  }

  const keyInfo = await simulateKeyPress(element, key, modifiers);

  return {
    pressed: true,
    key: keyInfo.key,
    code: keyInfo.code,
    targetElement: generateSelector(element),
    modifiers
  };
}

/**
 * Handler para digitar texto
 */
export async function handleTypeText(data) {
  const { selector, label, text, delay: keyDelay = 50 } = data;

  const field = findField(selector, label);
  if (!field) {
    throw new Error(`Field not found: ${selector || label}`);
  }

  await typeText(field, text, keyDelay);

  return {
    typed: true,
    text,
    selector: generateSelector(field)
  };
}

/**
 * Handler para focar elemento
 */
export async function handleFocusElement(data) {
  const { selector } = data;

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(100);

  if (element.focus) {
    element.focus();
  }

  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  return {
    focused: true,
    selector,
    isFocused: document.activeElement === element
  };
}

/**
 * Handler para obter elemento ativo
 */
export function handleGetActiveElement() {
  const element = document.activeElement;

  if (!element || element === document.body) {
    return {
      hasActiveElement: false,
      message: 'No element is currently focused'
    };
  }

  return {
    hasActiveElement: true,
    tagName: element.tagName.toLowerCase(),
    selector: generateSelector(element),
    id: element.id || null,
    type: element.type || null,
    value: element.value || null,
    placeholder: element.placeholder || null
  };
}

/**
 * Handler para scroll
 */
export async function handleScrollTo(data) {
  const { selector, position } = data;

  if (selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (position) {
    window.scrollTo({ top: position.y || 0, left: position.x || 0, behavior: 'smooth' });
  }

  return { scrolled: true };
}
