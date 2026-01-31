/**
 * Utilitários para eventos do DOM
 */

import { delay } from './dom.js';

/**
 * Simula eventos de mouse em um elemento
 */
export async function simulateMouseClick(element, options = {}) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const mouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    button: 0,
    buttons: 1,
    ...options
  };

  element.dispatchEvent(new MouseEvent('mouseenter', { ...mouseEventInit, bubbles: false }));
  element.dispatchEvent(new MouseEvent('mouseover', mouseEventInit));
  element.dispatchEvent(new MouseEvent('mousemove', mouseEventInit));
  element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));

  await delay(50);

  element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
  element.dispatchEvent(new MouseEvent('click', mouseEventInit));

  if (element.click) {
    element.click();
  }
}

/**
 * Simula duplo clique
 */
export async function simulateDoubleClick(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const mouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    detail: 2
  };

  element.dispatchEvent(new MouseEvent('mousedown', { ...mouseEventInit, detail: 1 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...mouseEventInit, detail: 1 }));
  element.dispatchEvent(new MouseEvent('click', { ...mouseEventInit, detail: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...mouseEventInit, detail: 2 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...mouseEventInit, detail: 2 }));
  element.dispatchEvent(new MouseEvent('click', { ...mouseEventInit, detail: 2 }));
  element.dispatchEvent(new MouseEvent('dblclick', mouseEventInit));
}

/**
 * Simula hover
 */
export function simulateHover(element) {
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

/**
 * Simula eventos de teclado
 */
export async function simulateKeyPress(element, key, modifiers = {}) {
  const keyCodeMap = {
    'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
    'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
    'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
    'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
    'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    'Home': { key: 'Home', code: 'Home', keyCode: 36 },
    'End': { key: 'End', code: 'End', keyCode: 35 },
    'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    'Space': { key: ' ', code: 'Space', keyCode: 32 },
    ' ': { key: ' ', code: 'Space', keyCode: 32 }
  };

  const keyInfo = keyCodeMap[key] || { key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };

  const eventInit = {
    key: keyInfo.key,
    code: keyInfo.code,
    keyCode: keyInfo.keyCode,
    which: keyInfo.keyCode,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.ctrl || false,
    shiftKey: modifiers.shift || false,
    altKey: modifiers.alt || false,
    metaKey: modifiers.meta || false
  };

  element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  element.dispatchEvent(new KeyboardEvent('keypress', eventInit));

  await delay(50);

  element.dispatchEvent(new KeyboardEvent('keyup', eventInit));

  return keyInfo;
}

/**
 * Preenche valor de um campo com eventos
 * Otimizado para textos grandes - usa chunks para evitar travamentos
 */
export async function fillFieldValue(field, value) {
  const CHUNK_SIZE = 500; // Caracteres por chunk
  const isLargeText = value.length > CHUNK_SIZE;

  field.focus();
  await delay(50);

  // Limpa o campo
  field.value = '';

  const descriptor = Object.getOwnPropertyDescriptor(
    field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  );

  if (isLargeText) {
    // Para textos grandes, insere em chunks para não travar
    console.log(`[Universal MCP] Large text detected (${value.length} chars), using chunked insertion`);

    let currentValue = '';
    const chunks = [];

    // Divide em chunks
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    // Insere chunk por chunk com pequena pausa
    for (let i = 0; i < chunks.length; i++) {
      currentValue += chunks[i];

      if (descriptor?.set) {
        descriptor.set.call(field, currentValue);
      } else {
        field.value = currentValue;
      }

      // Dispara input event apenas a cada chunk para não sobrecarregar
      // Usa flag cancelable: false para evitar que handlers da página bloqueiem
      const inputEvent = new Event('input', { bubbles: true, cancelable: false });
      field.dispatchEvent(inputEvent);

      // Pequena pausa entre chunks para dar tempo ao event loop
      if (i < chunks.length - 1) {
        await delay(10);
      }
    }
  } else {
    // Para textos pequenos, comportamento normal
    if (descriptor?.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Dispara change e keyup após todo o texto inserido
  field.dispatchEvent(new Event('change', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

  // Aguarda um pouco antes de blur para dar tempo aos handlers
  await delay(50);
  field.blur();
}

/**
 * Digita texto caractere por caractere
 */
export async function typeText(field, text, keyDelay = 50) {
  field.focus();
  field.value = '';

  for (const char of text) {
    field.value += char;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await delay(keyDelay);
  }

  field.dispatchEvent(new Event('change', { bubbles: true }));
}
