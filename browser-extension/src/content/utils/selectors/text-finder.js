/**
 * Text-based element finding utilities
 * Functions for finding elements by visible text and listing clickable elements
 */

import { isVisible, getElementDepth, getDirectTextContent, findClickableParent } from '../dom.js';
import { generateSelector } from '../selectors.js';

/**
 * Encontra elemento por texto
 */
export function findElementByText(text) {
  const textLower = text.toLowerCase().trim();

  // 1. Primeiro tenta botoes e inputs (alta prioridade)
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

  // 5. Busca em spans e divs com titulo
  const titledElements = document.querySelectorAll('[title]');
  for (const el of titledElements) {
    if (el.getAttribute('title')?.toLowerCase().includes(textLower) && isVisible(el)) {
      return findClickableParent(el) || el;
    }
  }

  // 6. Ultimo recurso: busca em qualquer elemento visivel
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
 * Retorna lista de elementos clicaveis na pagina
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
