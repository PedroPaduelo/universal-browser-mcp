/**
 * Accessibility tree extraction handlers
 * Provides faster and more semantic element discovery (3-10x faster than DOM traversal)
 */

import { generateSelector } from '../utils/selectors.js';
import { isVisible } from '../utils/dom.js';
import { pageCache } from '../utils/cache.js';

import { ROLE_TAG_MAP, findElementsByRoles, countRoles } from './accessibility/role-finder.js';
import { getAccessibleName, getAccessibilityStates } from './accessibility/accessible-name.js';
import { buildAccessibilityNode } from './accessibility/tree-builder.js';

/**
 * Handler to get the accessibility tree
 */
export function handleGetAccessibilityTree(data = {}) {
  const { maxDepth = 5, roles = null, root = null } = data;

  const cacheKey = `a11y_tree_${maxDepth}_${roles?.join(',') || 'all'}_${root || 'body'}`;

  return pageCache.get(cacheKey, () => {
    const rootElement = root ? document.querySelector(root) : document.body;
    if (!rootElement) {
      throw new Error(`Root element not found: ${root}`);
    }

    // If specific roles are requested, find elements by role directly
    if (roles && Array.isArray(roles) && roles.length > 0) {
      return findElementsByRoles(rootElement, roles);
    }

    // Build full tree
    const tree = buildAccessibilityNode(rootElement, 0, maxDepth);
    const summary = countRoles(tree);

    return {
      tree: tree ? [tree] : [],
      summary
    };
  }, 2000);
}

/**
 * Handler to find elements by ARIA role
 */
export function handleFindByRole(data) {
  const { role, name } = data;

  if (!role) {
    throw new Error('role is required');
  }

  const selectors = ROLE_TAG_MAP[role] || [`[role="${role}"]`];
  const elements = [];

  for (const selector of selectors) {
    try {
      document.querySelectorAll(selector).forEach(element => {
        if (!isVisible(element)) return;

        const accessibleName = getAccessibleName(element);

        // Filter by name if provided
        if (name && accessibleName) {
          const nameLower = name.toLowerCase();
          const accessibleNameLower = accessibleName.toLowerCase();
          if (!accessibleNameLower.includes(nameLower)) return;
        } else if (name && !accessibleName) {
          return;
        }

        const states = getAccessibilityStates(element);

        elements.push({
          role,
          name: accessibleName || undefined,
          selector: generateSelector(element),
          states: states.length > 0 ? states : undefined,
          value: element.value || undefined,
          tagName: element.tagName.toLowerCase()
        });
      });
    } catch (e) {
      // Invalid selector, skip
    }
  }

  return {
    found: elements.length > 0,
    count: elements.length,
    elements: elements.slice(0, 50) // Limit to 50 elements
  };
}

/**
 * Handler to highlight an element (for debugging)
 */
export async function handleHighlightElement(data) {
  const { selector, color = 'red', duration = 2000 } = data;

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Store original styles
  const originalOutline = element.style.outline;
  const originalOutlineOffset = element.style.outlineOffset;

  // Apply highlight
  element.style.outline = `3px solid ${color}`;
  element.style.outlineOffset = '2px';
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Remove highlight after duration
  return new Promise(resolve => {
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.outlineOffset = originalOutlineOffset;
      resolve({
        highlighted: true,
        selector,
        duration
      });
    }, duration);
  });
}

/**
 * Handler to get element center coordinates
 */
export function handleGetElementCenter(data) {
  const { selector } = data;

  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const visible = isVisible(element);
  const inViewport = (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );

  return {
    x: Math.round(centerX),
    y: Math.round(centerY),
    visible,
    inViewport,
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}
