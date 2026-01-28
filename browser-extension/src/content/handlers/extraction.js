/**
 * Handlers de extração de dados
 */

import { generateSelector } from '../utils/selectors.js';

/**
 * Handler para extrair texto
 */
export function handleExtractText(data) {
  const { selector } = data;

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return {
    text: element.innerText?.trim() || '',
    selector
  };
}

/**
 * Handler para extrair tabela
 */
export function handleExtractTable(data) {
  const { selector } = data;

  const table = document.querySelector(selector || 'table');
  if (!table) {
    throw new Error(`Table not found: ${selector || 'table'}`);
  }

  const headers = [];
  const rows = [];

  table.querySelectorAll('thead th, thead td, tr:first-child th').forEach(th => {
    headers.push(th.innerText?.trim() || '');
  });

  if (headers.length === 0) {
    table.querySelectorAll('tr:first-child td').forEach(td => {
      headers.push(td.innerText?.trim() || '');
    });
  }

  const dataRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
  dataRows.forEach(tr => {
    const row = [];
    tr.querySelectorAll('td').forEach(td => {
      row.push(td.innerText?.trim() || '');
    });
    if (row.length > 0) {
      rows.push(row);
    }
  });

  return {
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length
  };
}

/**
 * Handler para extrair HTML
 */
export function handleExtractHtml(data) {
  const { selector, outerHtml = true } = data || {};

  const element = selector ? document.querySelector(selector) : document.documentElement;
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return {
    selector: selector || 'html',
    html: outerHtml ? element.outerHTML : element.innerHTML,
    tagName: element.tagName.toLowerCase(),
    childCount: element.children.length
  };
}

/**
 * Handler para extrair estilos
 */
export function handleExtractStyles(data) {
  const { selector, includeComputed = true, includeInline = true, includeClasses = true } = data || {};

  const element = selector ? document.querySelector(selector) : document.body;
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  const result = {
    selector: selector || 'body',
    tagName: element.tagName.toLowerCase()
  };

  if (includeClasses) {
    result.classes = [...element.classList];
  }

  if (includeInline) {
    result.inlineStyles = element.getAttribute('style') || '';
    result.inlineStylesParsed = {};
    if (element.style.length > 0) {
      for (let i = 0; i < element.style.length; i++) {
        const prop = element.style[i];
        result.inlineStylesParsed[prop] = element.style.getPropertyValue(prop);
      }
    }
  }

  if (includeComputed) {
    const computed = window.getComputedStyle(element);
    result.computedStyles = {};

    const importantProps = [
      'display', 'position', 'width', 'height', 'margin', 'padding',
      'border', 'background', 'background-color', 'color', 'font-family',
      'font-size', 'font-weight', 'line-height', 'text-align', 'flex',
      'flex-direction', 'justify-content', 'align-items', 'grid',
      'gap', 'overflow', 'visibility', 'opacity', 'z-index',
      'box-shadow', 'border-radius', 'transform', 'transition'
    ];

    importantProps.forEach(prop => {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
        result.computedStyles[prop] = value;
      }
    });
  }

  if (!selector || selector === 'body' || selector === 'html') {
    result.stylesheetCount = document.styleSheets.length;
    result.externalStylesheets = [];

    for (const sheet of document.styleSheets) {
      if (sheet.href) {
        result.externalStylesheets.push(sheet.href);
      }
    }
  }

  return result;
}

/**
 * Handler para obter stylesheets
 */
export function handleGetStylesheets() {
  const stylesheets = [];

  for (const sheet of document.styleSheets) {
    const sheetInfo = {
      href: sheet.href,
      type: sheet.type,
      disabled: sheet.disabled,
      title: sheet.title,
      media: sheet.media?.mediaText || 'all',
      isExternal: !!sheet.href,
      rulesCount: 0,
      rules: []
    };

    try {
      if (sheet.cssRules) {
        sheetInfo.rulesCount = sheet.cssRules.length;

        const sampleSize = Math.min(10, sheet.cssRules.length);
        for (let i = 0; i < sampleSize; i++) {
          const rule = sheet.cssRules[i];
          sheetInfo.rules.push({
            type: rule.type,
            selector: rule.selectorText || null,
            cssText: rule.cssText?.substring(0, 200)
          });
        }
      }
    } catch (e) {
      sheetInfo.accessError = 'Cannot access rules (CORS restriction)';
    }

    stylesheets.push(sheetInfo);
  }

  const inlineStyles = document.querySelectorAll('style');
  inlineStyles.forEach((style, index) => {
    stylesheets.push({
      href: null,
      type: 'inline',
      index,
      content: style.textContent?.substring(0, 500),
      contentLength: style.textContent?.length || 0
    });
  });

  return {
    total: stylesheets.length,
    external: stylesheets.filter(s => s.isExternal).length,
    inline: stylesheets.filter(s => s.type === 'inline').length,
    stylesheets
  };
}
