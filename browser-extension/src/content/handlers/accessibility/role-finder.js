/**
 * Role-based element finding utilities
 * ARIA role to element mapping and role-based search
 */

import { generateSelector } from '../../utils/selectors.js';
import { isVisible } from '../../utils/dom.js';
import { getAccessibleName, getAccessibilityStates } from './accessible-name.js';

/**
 * ARIA role to element mapping
 */
export const ROLE_TAG_MAP = {
  button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', '[role="button"]'],
  link: ['a[href]', '[role="link"]'],
  textbox: ['input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'input:not([type])', 'textarea', '[role="textbox"]', '[contenteditable="true"]'],
  checkbox: ['input[type="checkbox"]', '[role="checkbox"]'],
  radio: ['input[type="radio"]', '[role="radio"]'],
  combobox: ['select', '[role="combobox"]', '[role="listbox"]'],
  listbox: ['select[multiple]', '[role="listbox"]'],
  option: ['option', '[role="option"]'],
  menuitem: ['[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]'],
  menu: ['[role="menu"]', '[role="menubar"]'],
  tab: ['[role="tab"]'],
  tabpanel: ['[role="tabpanel"]'],
  dialog: ['dialog', '[role="dialog"]', '[role="alertdialog"]'],
  heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
  img: ['img[alt]', '[role="img"]'],
  navigation: ['nav', '[role="navigation"]'],
  main: ['main', '[role="main"]'],
  form: ['form', '[role="form"]'],
  search: ['[role="search"]', 'input[type="search"]'],
  alert: ['[role="alert"]'],
  status: ['[role="status"]'],
  progressbar: ['progress', '[role="progressbar"]'],
  slider: ['input[type="range"]', '[role="slider"]'],
  switch: ['[role="switch"]'],
  grid: ['[role="grid"]', 'table'],
  row: ['tr', '[role="row"]'],
  cell: ['td', 'th', '[role="cell"]', '[role="gridcell"]'],
  columnheader: ['th', '[role="columnheader"]'],
  rowheader: ['th[scope="row"]', '[role="rowheader"]']
};

/**
 * Find elements by ARIA roles
 */
export function findElementsByRoles(root, roles) {
  const elements = [];
  const summary = {};

  for (const role of roles) {
    summary[role] = 0;
    const selectors = ROLE_TAG_MAP[role] || [`[role="${role}"]`];

    for (const selector of selectors) {
      try {
        root.querySelectorAll(selector).forEach(element => {
          if (!isVisible(element)) return;

          const name = getAccessibleName(element);
          const states = getAccessibilityStates(element);

          elements.push({
            role,
            name: name || undefined,
            selector: generateSelector(element),
            states: states.length > 0 ? states : undefined,
            value: element.value || undefined
          });
          summary[role]++;
        });
      } catch (e) {
        // Invalid selector, skip
      }
    }
  }

  return {
    tree: elements,
    summary
  };
}

/**
 * Count roles in the tree
 */
export function countRoles(node, counts = {}) {
  if (!node) return counts;

  if (node.role) {
    counts[node.role] = (counts[node.role] || 0) + 1;
  }

  if (node.children) {
    for (const child of node.children) {
      countRoles(child, counts);
    }
  }

  return counts;
}
