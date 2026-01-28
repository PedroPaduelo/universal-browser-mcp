/**
 * Handlers de validação de página
 */

import { generateSelector } from '../utils/selectors.js';

/**
 * Handler para validar página
 */
export function handleValidatePage(data) {
  const { selector, rules = [] } = data || {};

  const container = selector ? document.querySelector(selector) : document.body;
  if (!container) {
    throw new Error(`Container not found: ${selector}`);
  }

  const results = {
    container: selector || 'body',
    timestamp: new Date().toISOString(),
    url: window.location.href,
    totalRules: rules.length,
    passed: 0,
    failed: 0,
    validations: []
  };

  if (rules.length === 0) {
    results.autoValidation = performAutoValidation(container);
    return results;
  }

  for (const rule of rules) {
    const validation = executeValidationRule(container, rule);
    results.validations.push(validation);

    if (validation.passed) {
      results.passed++;
    } else {
      results.failed++;
    }
  }

  results.success = results.failed === 0;
  return results;
}

/**
 * Executa uma regra de validação
 */
function executeValidationRule(container, rule) {
  const { type, selector, expected, property, description } = rule;

  const result = {
    type,
    selector,
    description: description || `${type}: ${selector}`,
    passed: false,
    actual: null,
    expected: expected
  };

  try {
    const elements = container.querySelectorAll(selector);
    const element = elements[0];

    switch (type) {
      case 'element_exists':
        result.actual = elements.length > 0;
        result.passed = result.actual === (expected !== false);
        break;

      case 'element_count':
        result.actual = elements.length;
        result.passed = elements.length === expected;
        break;

      case 'has_class':
        if (!element) {
          result.actual = null;
          result.passed = false;
        } else {
          result.actual = element.classList.contains(expected);
          result.passed = result.actual;
        }
        break;

      case 'has_style':
        if (!element) {
          result.actual = null;
          result.passed = false;
        } else {
          const computed = window.getComputedStyle(element);
          result.actual = computed.getPropertyValue(property);
          result.passed = result.actual === expected || result.actual.includes(expected);
        }
        break;

      case 'has_attribute':
        if (!element) {
          result.actual = null;
          result.passed = false;
        } else {
          result.actual = element.getAttribute(property);
          result.passed = expected === undefined
            ? element.hasAttribute(property)
            : result.actual === expected;
        }
        break;

      case 'text_contains':
        if (!element) {
          result.actual = null;
          result.passed = false;
        } else {
          result.actual = element.textContent?.trim().substring(0, 100);
          result.passed = element.textContent?.includes(expected) || false;
        }
        break;

      case 'text_equals':
        if (!element) {
          result.actual = null;
          result.passed = false;
        } else {
          result.actual = element.textContent?.trim();
          result.passed = result.actual === expected;
        }
        break;

      default:
        result.error = `Unknown validation type: ${type}`;
    }
  } catch (error) {
    result.error = error.message;
    result.passed = false;
  }

  return result;
}

/**
 * Realiza validação automática
 */
function performAutoValidation(container) {
  const issues = [];
  const info = {
    elements: {},
    accessibility: {},
    seo: {},
    performance: {}
  };

  info.elements = {
    total: container.querySelectorAll('*').length,
    forms: container.querySelectorAll('form').length,
    inputs: container.querySelectorAll('input, select, textarea').length,
    buttons: container.querySelectorAll('button, input[type="submit"]').length,
    links: container.querySelectorAll('a').length,
    images: container.querySelectorAll('img').length,
    tables: container.querySelectorAll('table').length,
    headings: {
      h1: container.querySelectorAll('h1').length,
      h2: container.querySelectorAll('h2').length,
      h3: container.querySelectorAll('h3').length
    }
  };

  const imagesWithoutAlt = container.querySelectorAll('img:not([alt])');
  if (imagesWithoutAlt.length > 0) {
    issues.push({
      type: 'accessibility',
      severity: 'warning',
      message: `${imagesWithoutAlt.length} imagem(ns) sem atributo alt`,
      elements: [...imagesWithoutAlt].map(el => generateSelector(el)).slice(0, 5)
    });
  }

  const inputsWithoutLabel = [];
  container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').forEach(input => {
    const hasLabel = input.id && container.querySelector(`label[for="${input.id}"]`);
    const hasAriaLabel = input.getAttribute('aria-label');
    const insideLabel = input.closest('label');

    if (!hasLabel && !hasAriaLabel && !insideLabel) {
      inputsWithoutLabel.push(input);
    }
  });

  if (inputsWithoutLabel.length > 0) {
    issues.push({
      type: 'accessibility',
      severity: 'warning',
      message: `${inputsWithoutLabel.length} campo(s) sem label associado`,
      elements: inputsWithoutLabel.map(el => generateSelector(el)).slice(0, 5)
    });
  }

  const formsWithoutAction = container.querySelectorAll('form:not([action])');
  if (formsWithoutAction.length > 0) {
    issues.push({
      type: 'form',
      severity: 'info',
      message: `${formsWithoutAction.length} formulário(s) sem atributo action`
    });
  }

  const brokenLinks = container.querySelectorAll('a:not([href]), a[href=""], a[href="#"]');
  if (brokenLinks.length > 0) {
    issues.push({
      type: 'seo',
      severity: 'warning',
      message: `${brokenLinks.length} link(s) sem href válido`
    });
  }

  if (info.elements.headings.h1 > 1) {
    issues.push({
      type: 'seo',
      severity: 'warning',
      message: `Página tem ${info.elements.headings.h1} tags H1 (recomendado: 1)`
    });
  }

  const inlineStyles = container.querySelectorAll('[style]');
  info.performance.inlineStyleCount = inlineStyles.length;
  if (inlineStyles.length > 10) {
    issues.push({
      type: 'performance',
      severity: 'info',
      message: `${inlineStyles.length} elementos com estilo inline (considere usar classes CSS)`
    });
  }

  container.querySelectorAll('table').forEach(table => {
    if (!table.querySelector('th') && !table.querySelector('thead')) {
      issues.push({
        type: 'accessibility',
        severity: 'warning',
        message: 'Tabela sem cabeçalho (th/thead)',
        elements: [generateSelector(table)]
      });
    }
  });

  info.accessibility.issueCount = issues.filter(i => i.type === 'accessibility').length;
  info.seo.issueCount = issues.filter(i => i.type === 'seo').length;

  return {
    score: Math.max(0, 100 - (issues.length * 5)),
    issueCount: issues.length,
    issues,
    info
  };
}
