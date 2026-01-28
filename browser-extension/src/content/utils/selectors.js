/**
 * Utilitários para geração e busca de seletores
 */

import { isVisible, getElementDepth, getDirectTextContent, findClickableParent } from './dom.js';

/**
 * Gera um seletor CSS para um elemento
 */
export function generateSelector(element) {
  if (!element) return null;

  if (element.id) {
    return `#${element.id}`;
  }

  if (element.name) {
    return `[name="${element.name}"]`;
  }

  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c && !c.includes(':'));
      if (classes.length > 0) {
        selector += '.' + classes.slice(0, 2).join('.');
      }
    }

    const siblings = current.parentElement?.querySelectorAll(`:scope > ${current.tagName.toLowerCase()}`);
    if (siblings && siblings.length > 1) {
      const index = [...siblings].indexOf(current) + 1;
      selector += `:nth-of-type(${index})`;
    }

    path.unshift(selector);
    current = current.parentElement;

    if (path.length > 4) break;
  }

  return path.join(' > ');
}

/**
 * Gera seletores alternativos para um elemento
 */
export function generateAlternativeSelectors(element) {
  const selectors = [];

  if (element.id) {
    selectors.push(`#${element.id}`);
  }

  if (element.getAttribute('data-testid')) {
    selectors.push(`[data-testid="${element.getAttribute('data-testid')}"]`);
  }

  if (element.getAttribute('aria-label')) {
    selectors.push(`[aria-label="${element.getAttribute('aria-label')}"]`);
  }

  if (element.name) {
    selectors.push(`[name="${element.name}"]`);
  }

  if (element.title) {
    selectors.push(`[title="${element.title}"]`);
  }

  selectors.push(generateSelector(element));

  return selectors;
}

/**
 * Encontra label associada a um campo
 */
export function findLabelForField(field) {
  if (field.id) {
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (label) return label.textContent?.trim();
  }

  const parent = field.closest('label');
  if (parent) {
    return parent.textContent?.replace(field.value || '', '').trim();
  }

  if (field.getAttribute('aria-label')) {
    return field.getAttribute('aria-label');
  }

  if (field.placeholder) {
    return field.placeholder;
  }

  return field.name || field.id || null;
}

/**
 * Encontra um campo por seletor ou label
 */
export function findField(selector, label) {
  if (selector) {
    const field = document.querySelector(selector);
    if (field) return field;
  }

  if (label) {
    return findFieldByLabel(label);
  }

  return null;
}

/**
 * Encontra campo por label
 */
export function findFieldByLabel(label) {
  const labelLower = label.toLowerCase();

  const labels = [...document.querySelectorAll('label')];
  for (const labelEl of labels) {
    if (labelEl.textContent?.toLowerCase().includes(labelLower)) {
      if (labelEl.htmlFor) {
        const field = document.getElementById(labelEl.htmlFor);
        if (field) return field;
      }

      const field = labelEl.querySelector('input, select, textarea');
      if (field) return field;
    }
  }

  const byPlaceholder = document.querySelector(
    `input[placeholder*="${label}" i], textarea[placeholder*="${label}" i]`
  );
  if (byPlaceholder) return byPlaceholder;

  const byAria = document.querySelector(`[aria-label*="${label}" i]`);
  if (byAria) return byAria;

  const normalizedLabel = label.toLowerCase().replace(/\s+/g, '');
  const inputs = document.querySelectorAll('input, select, textarea');
  for (const input of inputs) {
    const name = (input.name || '').toLowerCase().replace(/[_-]/g, '');
    if (name.includes(normalizedLabel)) return input;
  }

  return null;
}

/**
 * Encontra elemento por texto
 */
export function findElementByText(text) {
  const textLower = text.toLowerCase().trim();

  // 1. Primeiro tenta botões e inputs (alta prioridade)
  const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
  for (const btn of buttons) {
    const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
    if (btnText.includes(textLower) && isVisible(btn)) return btn;
  }

  // 2. Tenta links
  const links = document.querySelectorAll('a');
  for (const link of links) {
    if (link.textContent?.toLowerCase().trim().includes(textLower) && isVisible(link)) return link;
  }

  // 3. Tenta elementos com onclick ou role
  const clickables = document.querySelectorAll('[onclick], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="listitem"]');
  for (const el of clickables) {
    if (el.textContent?.toLowerCase().trim().includes(textLower) && isVisible(el)) return el;
  }

  // 4. Tenta elementos com data-testid ou aria-label
  const dataElements = document.querySelectorAll('[data-testid], [aria-label]');
  for (const el of dataElements) {
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
    const testId = el.getAttribute('data-testid')?.toLowerCase() || '';
    if ((ariaLabel.includes(textLower) || testId.includes(textLower)) && isVisible(el)) return el;
  }

  // 5. Busca em spans e divs com título
  const titledElements = document.querySelectorAll('[title]');
  for (const el of titledElements) {
    if (el.getAttribute('title')?.toLowerCase().includes(textLower) && isVisible(el)) {
      return findClickableParent(el) || el;
    }
  }

  // 6. Último recurso: busca em qualquer elemento visível
  const allElements = [...document.querySelectorAll('div, span, li, td, p, label')];

  allElements.sort((a, b) => {
    const depthA = getElementDepth(a);
    const depthB = getElementDepth(b);
    return depthB - depthA;
  });

  for (const el of allElements) {
    if (!isVisible(el)) continue;

    const directText = getDirectTextContent(el).toLowerCase().trim();
    if (directText.includes(textLower)) {
      return findClickableParent(el) || el;
    }
  }

  return null;
}

/**
 * Retorna lista de elementos clicáveis na página
 */
export function getClickableElements() {
  const clickables = [];
  const seen = new Set();

  const selectors = [
    'button', 'a[href]', 'input[type="submit"]', 'input[type="button"]',
    '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="option"]',
    '[role="listitem"]', '[onclick]', '[tabindex="0"]', '[data-testid]'
  ];

  document.querySelectorAll(selectors.join(', ')).forEach(el => {
    if (!isVisible(el)) return;

    const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
    const key = `${text}-${el.tagName}-${el.className}`;

    if (seen.has(key) || !text) return;
    seen.add(key);

    clickables.push({
      text: text.substring(0, 100),
      tagName: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute('role') || 'element',
      selector: generateSelector(el),
      id: el.id || null,
      testId: el.getAttribute('data-testid') || null,
      ariaLabel: el.getAttribute('aria-label') || null
    });
  });

  return clickables.slice(0, 100);
}
