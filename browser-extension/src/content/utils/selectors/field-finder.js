/**
 * Field finding utilities
 * Functions for finding form fields by label, selector, or name
 */

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
