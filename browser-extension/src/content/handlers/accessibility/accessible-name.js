/**
 * Accessible name and role computation utilities
 * Implements accessible name calculation, role computation, and state detection
 */

import { isVisible } from '../../utils/dom.js';

/**
 * Get the computed accessible name for an element
 */
export function getAccessibleName(element) {
  // Priority: aria-labelledby > aria-label > associated label > title > alt > text content

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElements = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean);
    if (labelElements.length > 0) {
      return labelElements.map(el => el.textContent).join(' ').trim();
    }
  }

  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Associated label (for form elements)
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent?.trim();
  }

  // Label wrapping the element
  const parentLabel = element.closest('label');
  if (parentLabel) {
    // Get text excluding the input's own text
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, select, textarea');
    inputs.forEach(i => i.remove());
    return clone.textContent?.trim();
  }

  // title attribute
  if (element.title) return element.title;

  // alt attribute (for images)
  if (element.alt) return element.alt;

  // placeholder (for inputs)
  if (element.placeholder) return element.placeholder;

  // value (for buttons)
  if (element.value && ['submit', 'button', 'reset'].includes(element.type)) {
    return element.value;
  }

  // Text content (limited for performance)
  const text = element.textContent?.trim();
  if (text && text.length <= 100) return text;
  if (text) return text.substring(0, 100) + '...';

  return '';
}

/**
 * Get the computed role of an element
 */
export function getComputedRole(element) {
  // Explicit role
  const explicitRole = element.getAttribute('role');
  if (explicitRole) return explicitRole;

  // Implicit roles based on tag
  const tag = element.tagName.toLowerCase();
  const type = element.type?.toLowerCase();

  const roleMap = {
    'button': 'button',
    'a': element.href ? 'link' : null,
    'input': {
      'button': 'button',
      'submit': 'button',
      'reset': 'button',
      'checkbox': 'checkbox',
      'radio': 'radio',
      'range': 'slider',
      'search': 'searchbox',
      'text': 'textbox',
      'email': 'textbox',
      'password': 'textbox',
      'tel': 'textbox',
      'url': 'textbox'
    },
    'select': element.multiple ? 'listbox' : 'combobox',
    'textarea': 'textbox',
    'img': 'img',
    'h1': 'heading',
    'h2': 'heading',
    'h3': 'heading',
    'h4': 'heading',
    'h5': 'heading',
    'h6': 'heading',
    'nav': 'navigation',
    'main': 'main',
    'header': 'banner',
    'footer': 'contentinfo',
    'aside': 'complementary',
    'article': 'article',
    'section': 'region',
    'form': 'form',
    'table': 'table',
    'tr': 'row',
    'td': 'cell',
    'th': 'columnheader',
    'ul': 'list',
    'ol': 'list',
    'li': 'listitem',
    'dialog': 'dialog',
    'progress': 'progressbar',
    'option': 'option'
  };

  if (tag === 'input' && roleMap['input'][type]) {
    return roleMap['input'][type];
  }

  return roleMap[tag] || null;
}

/**
 * Get accessibility states for an element
 */
export function getAccessibilityStates(element) {
  const states = [];

  // Disabled state
  if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
    states.push('disabled');
  }

  // Checked state
  if (element.checked || element.getAttribute('aria-checked') === 'true') {
    states.push('checked');
  } else if (element.getAttribute('aria-checked') === 'mixed') {
    states.push('mixed');
  }

  // Selected state
  if (element.selected || element.getAttribute('aria-selected') === 'true') {
    states.push('selected');
  }

  // Expanded state
  const expanded = element.getAttribute('aria-expanded');
  if (expanded === 'true') states.push('expanded');
  else if (expanded === 'false') states.push('collapsed');

  // Pressed state (for toggle buttons)
  const pressed = element.getAttribute('aria-pressed');
  if (pressed === 'true') states.push('pressed');

  // Required state
  if (element.required || element.getAttribute('aria-required') === 'true') {
    states.push('required');
  }

  // Invalid state
  if (element.getAttribute('aria-invalid') === 'true') {
    states.push('invalid');
  }

  // Busy state
  if (element.getAttribute('aria-busy') === 'true') {
    states.push('busy');
  }

  // Focused
  if (document.activeElement === element) {
    states.push('focused');
  }

  // Visibility
  if (!isVisible(element)) {
    states.push('hidden');
  }

  return states;
}
