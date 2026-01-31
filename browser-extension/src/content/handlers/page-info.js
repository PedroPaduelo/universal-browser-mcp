/**
 * Handlers para informações da página
 * With lazy loading options and caching for better performance
 */

import { generateSelector, findLabelForField, getClickableElements } from '../utils/selectors.js';
import { isVisible } from '../utils/dom.js';
import { pageCache } from '../utils/cache.js';

/**
 * Extrai informações de formulários
 * @param {number} maxFields - Maximum fields per form (default: unlimited)
 */
export function extractForms(maxFields = Infinity) {
  return pageCache.get('forms', () => {
    const forms = [];
    document.querySelectorAll('form').forEach((form, index) => {
      const fields = [];
      let fieldCount = 0;

      form.querySelectorAll('input, select, textarea').forEach(field => {
        if (fieldCount >= maxFields) return;

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
        fieldCount++;
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
  });
}

/**
 * Extrai informações de botões
 * @param {number} maxButtons - Maximum buttons to return (default: 50)
 */
export function extractButtons(maxButtons = 50) {
  return pageCache.get(`buttons_${maxButtons}`, () => {
    const buttons = [];
    const seen = new Set();

    document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button').forEach(btn => {
      if (buttons.length >= maxButtons) return;

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

    return buttons;
  });
}

/**
 * Extrai informações de inputs
 * @param {number} maxInputs - Maximum inputs to return (default: 100)
 */
export function extractInputs(maxInputs = 100) {
  return pageCache.get(`inputs_${maxInputs}`, () => {
    const inputs = [];

    document.querySelectorAll('input, select, textarea').forEach(field => {
      if (inputs.length >= maxInputs) return;
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
  });
}

/**
 * Handler para obter informações completas da página
 * Supports lazy loading options to reduce payload size
 *
 * @param {string|Object} sessionIdOrData - Session ID or options object
 */
export function handleGetPageInfo(sessionIdOrData) {
  // Handle both old API (sessionId string) and new API (options object)
  let sessionId = null;
  let options = {};

  if (typeof sessionIdOrData === 'string') {
    sessionId = sessionIdOrData;
  } else if (sessionIdOrData && typeof sessionIdOrData === 'object') {
    sessionId = sessionIdOrData.sessionId;
    options = sessionIdOrData;
  }

  const {
    includeForms = true,
    includeButtons = true,
    includeLinks = true,
    includeInputs = true,
    includeClickable = true,
    maxElements = 100
  } = options;

  const result = {
    sessionId,
    url: window.location.href,
    title: document.title,
    meta: {
      hasPassword: !!document.querySelector('input[type="password"]'),
      hasSearch: !!document.querySelector('input[type="search"]')
    }
  };

  if (includeForms) {
    result.forms = extractForms(maxElements);
    result.meta.formCount = result.forms.length;
  }

  if (includeButtons) {
    result.buttons = extractButtons(Math.min(maxElements, 50));
    result.meta.buttonCount = result.buttons.length;
  }

  if (includeLinks) {
    const linksResult = handleExtractLinks({ limit: Math.min(maxElements, 50) });
    result.links = linksResult.data;
    result.meta.linkCount = linksResult.data.length;
  }

  if (includeInputs) {
    result.inputs = extractInputs(maxElements);
    result.meta.inputCount = result.inputs.length;
  }

  if (includeClickable) {
    result.clickableElements = getClickableElements().slice(0, maxElements);
    result.meta.clickableCount = result.clickableElements.length;
  }

  return result;
}

/**
 * Lightweight page snapshot for AI context efficiency
 * Returns ~2KB vs ~20KB for full get_page_info
 */
export function handleGetPageSnapshot() {
  return pageCache.get('page_snapshot', () => {
    // Get visible text (truncated)
    const bodyText = document.body?.innerText || '';
    const visibleText = bodyText.substring(0, 1000).trim();

    // Get key interactive elements only (limited)
    const keyElements = [];
    const maxElements = 20;

    // Get primary actions (buttons with prominent text)
    document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach(el => {
      if (keyElements.length >= maxElements) return;
      if (!isVisible(el)) return;

      const text = (el.textContent || el.value || '').trim();
      if (text && text.length <= 30) {
        keyElements.push({
          type: 'button',
          text,
          selector: generateSelector(el)
        });
      }
    });

    // Get main form fields
    document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(el => {
      if (keyElements.length >= maxElements) return;
      if (!isVisible(el)) return;

      const label = findLabelForField(el) || el.placeholder || el.name;
      if (label) {
        keyElements.push({
          type: el.tagName.toLowerCase(),
          inputType: el.type || null,
          label,
          value: el.type === 'password' ? '***' : (el.value || ''),
          selector: generateSelector(el)
        });
      }
    });

    // Get navigation links
    document.querySelectorAll('nav a, [role="navigation"] a, header a').forEach(el => {
      if (keyElements.length >= maxElements) return;
      if (!isVisible(el)) return;

      const text = el.textContent?.trim();
      if (text && text.length <= 30) {
        keyElements.push({
          type: 'nav-link',
          text,
          href: el.href,
          selector: generateSelector(el)
        });
      }
    });

    return {
      url: window.location.href,
      title: document.title,
      visibleText,
      keyElements,
      meta: {
        hasPassword: !!document.querySelector('input[type="password"]'),
        hasSearch: !!document.querySelector('input[type="search"]'),
        hasForm: !!document.querySelector('form'),
        formCount: document.querySelectorAll('form').length,
        buttonCount: document.querySelectorAll('button, [role="button"]').length,
        linkCount: document.querySelectorAll('a[href]').length
      }
    };
  }, 1000); // Shorter TTL for snapshot
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
