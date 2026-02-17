/**
 * Accessibility tree building utilities
 * Constructs accessibility tree nodes from DOM elements
 */

import { generateSelector } from '../../utils/selectors.js';
import { getAccessibleName, getComputedRole, getAccessibilityStates } from './accessible-name.js';

/**
 * Build accessibility node for an element
 */
export function buildAccessibilityNode(element, depth = 0, maxDepth = 5) {
  const role = getComputedRole(element);
  if (!role) return null;

  const name = getAccessibleName(element);
  const states = getAccessibilityStates(element);

  const node = {
    role,
    name: name || undefined,
    selector: generateSelector(element),
    states: states.length > 0 ? states : undefined
  };

  // Add value for form elements
  if (['textbox', 'combobox', 'slider', 'spinbutton'].includes(role)) {
    node.value = element.value || '';
  }

  // Add level for headings
  if (role === 'heading') {
    const tag = element.tagName.toLowerCase();
    const level = element.getAttribute('aria-level') || tag.replace('h', '');
    node.level = parseInt(level, 10);
  }

  // Add children if not at max depth
  if (depth < maxDepth) {
    const childNodes = [];
    for (const child of element.children) {
      const childNode = buildAccessibilityNode(child, depth + 1, maxDepth);
      if (childNode) {
        childNodes.push(childNode);
      }
    }
    if (childNodes.length > 0) {
      node.children = childNodes;
    }
  }

  return node;
}
