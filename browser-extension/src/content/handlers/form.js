/**
 * Handlers de formulários
 */

import { generateSelector, findField, findLabelForField } from '../utils/selectors.js';
import { fillFieldValue } from '../utils/events.js';
import { delay } from '../utils/dom.js';

/**
 * Handler para preencher campo
 */
export async function handleFillField(data) {
  const { selector, label, value } = data;

  const field = findField(selector, label);
  if (!field) {
    throw new Error(`Field not found: ${selector || label}`);
  }

  await fillFieldValue(field, value);

  return {
    filled: true,
    selector: generateSelector(field),
    label: findLabelForField(field)
  };
}

/**
 * Handler para preencher formulário
 */
export async function handleFillForm(data) {
  const { fields } = data;
  const results = [];
  let successCount = 0;

  for (const fieldData of fields) {
    try {
      const result = await handleFillField(fieldData);
      results.push({ ...fieldData, success: true, ...result });
      successCount++;
    } catch (error) {
      results.push({ ...fieldData, success: false, error: error.message });
    }

    await delay(50);
  }

  return {
    totalFields: fields.length,
    successCount,
    failedCount: fields.length - successCount,
    results
  };
}

/**
 * Handler para selecionar opção
 */
export async function handleSelectOption(data) {
  const { selector, label, value, text } = data;

  const select = findField(selector, label);
  if (!select || select.tagName !== 'SELECT') {
    throw new Error(`Select element not found: ${selector || label}`);
  }

  let optionFound = false;

  for (const option of select.options) {
    if (
      (value && option.value === value) ||
      (text && option.text.toLowerCase().includes(text.toLowerCase()))
    ) {
      select.value = option.value;
      optionFound = true;
      break;
    }
  }

  if (!optionFound) {
    throw new Error(`Option not found: ${value || text}`);
  }

  select.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    selected: true,
    value: select.value,
    text: select.options[select.selectedIndex]?.text
  };
}

/**
 * Handler para extrair dados do formulário
 */
export function handleExtractFormData(data) {
  const { selector } = data || {};

  const form = selector ? document.querySelector(selector) : document.querySelector('form');
  if (!form) {
    throw new Error('Form not found');
  }

  const formData = {};
  const formElements = form.querySelectorAll('input, select, textarea');

  formElements.forEach(field => {
    const name = field.name || field.id;
    if (!name) return;

    if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.checked) {
        formData[name] = field.value;
      }
    } else if (field.type !== 'password') {
      formData[name] = field.value;
    }
  });

  return { formData, selector: generateSelector(form) };
}
