/**
 * Handlers para informações da página
 */

import { generateSelector, findLabelForField, getClickableElements } from '../utils/selectors.js';
import { isVisible } from '../utils/dom.js';

/**
 * Extrai informações de formulários
 */
export function extractForms() {
  const forms = [];
  document.querySelectorAll('form').forEach((form, index) => {
    const fields = [];

    form.querySelectorAll('input, select, textarea').forEach(field => {
      const label = findLabelForField(field);
      fields.push({
        type: field.tagName.toLowerCase(),
        inputType: field.type || null,
        name: field.name || null,
        id: field.id || null,
        label: label,
        placeholder: field.placeholder || null,
        required: field.required,
        value: field.type === 'password' ? '***' : (field.value || null),
        selector: generateSelector(field),
        options: field.tagName === 'SELECT' ?
          [...field.options].map(o => ({ value: o.value, text: o.text })) : null
      });
    });

    forms.push({
      index,
      id: form.id || null,
      name: form.name || null,
      action: form.action || null,
      method: form.method || 'get',
      selector: generateSelector(form),
      fields
    });
  });

  return forms;
}

/**
 * Extrai informações de botões
 */
export function extractButtons() {
  const buttons = [];
  const seen = new Set();

  document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button').forEach(btn => {
    const text = btn.textContent?.trim() || btn.value || '';
    const key = `${text}-${btn.className}`;

    if (seen.has(key) || !text) return;
    seen.add(key);

    buttons.push({
      text: text.substring(0, 100),
      type: btn.type || btn.tagName.toLowerCase(),
      id: btn.id || null,
      selector: generateSelector(btn),
      disabled: btn.disabled || false,
      visible: isVisible(btn)
    });
  });

  return buttons.slice(0, 50);
}

/**
 * Extrai informações de inputs
 */
export function extractInputs() {
  const inputs = [];

  document.querySelectorAll('input, select, textarea').forEach(field => {
    if (field.type === 'hidden') return;

    const label = findLabelForField(field);
    inputs.push({
      type: field.tagName.toLowerCase(),
      inputType: field.type || null,
      name: field.name || null,
      id: field.id || null,
      label,
      placeholder: field.placeholder || null,
      selector: generateSelector(field),
      visible: isVisible(field)
    });
  });

  return inputs;
}

/**
 * Handler para obter informações completas da página
 */
export function handleGetPageInfo(sessionId) {
  const forms = extractForms();
  const buttons = extractButtons();
  const linksResult = handleExtractLinks({ limit: 50 });
  const inputs = extractInputs();
  const clickableElements = getClickableElements();

  return {
    sessionId,
    url: window.location.href,
    title: document.title,
    forms,
    buttons,
    links: linksResult.data,
    inputs,
    clickableElements,
    meta: {
      hasPassword: !!document.querySelector('input[type="password"]'),
      hasSearch: !!document.querySelector('input[type="search"]'),
      formCount: forms.length,
      buttonCount: buttons.length,
      linkCount: linksResult.data.length,
      inputCount: inputs.length,
      clickableCount: clickableElements.length
    }
  };
}

export function handleGetPageTitle() {
  return { title: document.title };
}

export function handleGetPageText(data) {
  const { selector } = data || {};
  const element = selector ? document.querySelector(selector) : document.body;

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return {
    text: element.innerText?.trim() || '',
    selector: selector || 'body'
  };
}

export function handleGetPageHtml(data) {
  const { selector } = data || {};
  const element = selector ? document.querySelector(selector) : document.documentElement;

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return {
    html: element.outerHTML,
    selector: selector || 'html'
  };
}

/**
 * Handler para extrair links
 */
export function handleExtractLinks(data) {
  const { selector, limit = 100 } = data || {};

  const container = selector ? document.querySelector(selector) : document;
  const links = [];

  container?.querySelectorAll('a[href]').forEach(a => {
    if (links.length >= limit) return;

    const href = a.href;
    const text = a.innerText?.trim() || a.title || '';

    if (href && !href.startsWith('javascript:')) {
      links.push({
        text: text.substring(0, 200),
        href,
        selector: generateSelector(a)
      });
    }
  });

  return { data: links, count: links.length };
}
