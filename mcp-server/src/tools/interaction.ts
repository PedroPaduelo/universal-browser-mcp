/**
 * Interaction tools
 * - fill_field, fill_form
 * - click_element, double_click
 * - select_option
 * - type_text
 * - hover_element
 * - scroll_to
 * - press_key
 * - focus_element
 * - get_active_element
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeServer } from '../websocket/bridge-server.js';
import {
  FillFieldSchema,
  FillFormSchema,
  ClickElementSchema,
  SelectOptionSchema,
  TypeTextSchema
} from '../schemas/index.js';
import { SessionManager, getSessionOrError } from '../session-manager.js';

export function registerInteractionTools(mcpServer: McpServer, bridgeServer: BridgeServer, sessionManager: SessionManager) {
  mcpServer.tool(
    'fill_field',
    `Fill a form field.

INPUT:
- selector: CSS selector OR
- label: Visible label text
- value: Value to fill (required)`,
    {
      selector: z.string().optional().describe('CSS selector'),
      label: z.string().optional().describe('Label text'),
      value: z.string().describe('Value to fill')
    },
    async (params, extra) => {
      FillFieldSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'fill_field', data: params }, 10000);
        return { content: [{ type: 'text', text: `Filled: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'fill_form',
    'Fill multiple form fields at once.',
    {
      fields: z.array(z.object({
        selector: z.string().optional(),
        label: z.string().optional(),
        value: z.string()
      })).describe('Array of fields with selector/label and value')
    },
    async ({ fields }, extra) => {
      FillFormSchema.parse({ fields });

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'fill_form', data: { fields } }, 15000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error filling form: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'click_element',
    `Click an element by selector or text.

INPUT (provide ONE):
- selector: CSS selector (e.g., "[data-testid='btn']")
- text: Visible text (e.g., "Login")
- clickParent: Auto-find clickable parent (default: true)`,
    {
      selector: z.string().optional().describe('CSS selector'),
      text: z.string().optional().describe('Visible text'),
      clickParent: z.boolean().optional()
    },
    async (params, extra) => {
      ClickElementSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'click_element', data: params }, 10000);
        return { content: [{ type: 'text', text: `Clicked: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'double_click',
    `Double-click an element. Useful for:
- Selecting words in text fields
- Opening items in lists
- Editing table cells`,
    {
      selector: z.string().optional().describe('CSS selector of the element'),
      text: z.string().optional().describe('Visible text of the element')
    },
    async (params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'double_click', data: params }, 10000);
        return { content: [{ type: 'text', text: `Double-clicked: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'select_option',
    'Select an option in a dropdown/select element.',
    {
      selector: z.string().optional().describe('CSS selector of the select element'),
      label: z.string().optional().describe('Label of the select field'),
      value: z.string().optional().describe('Value attribute of the option'),
      text: z.string().optional().describe('Visible text of the option')
    },
    async (params, extra) => {
      SelectOptionSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'select_option', data: params }, 10000);
        return { content: [{ type: 'text', text: `Option selected: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error selecting option: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'type_text',
    `Type text character by character, simulating real keyboard input.

WHEN TO USE vs fill_field:
- fill_field: Instant fill (faster, works for most fields)
- type_text: Character-by-character (slower, but triggers autocomplete/validation)

USE type_text FOR:
- Search fields with autocomplete (Google, etc.)
- Fields that validate while typing
- Fields that trigger suggestions
- When fill_field doesn't work

INPUT:
- selector or label: Field to type into (provide one)
- text: Text to type
- delay: Delay between keystrokes in ms (default: 50)

EXAMPLE:
{ "label": "Search", "text": "search term", "delay": 100 }

WORKFLOW:
focus_element (optional) -> type_text -> wait for autocomplete -> click suggestion`,
    {
      selector: z.string().optional().describe('CSS selector of the field'),
      label: z.string().optional().describe('Label text of the field'),
      text: z.string().describe('Text to type'),
      delay: z.number().optional().describe('Delay between keystrokes in ms (default: 50)')
    },
    async (params, extra) => {
      TypeTextSchema.parse(params);

      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'type_text', data: params }, 30000);
        return { content: [{ type: 'text', text: `Text typed: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error typing: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'hover_element',
    'Move the mouse over an element (hover).',
    {
      selector: z.string().describe('CSS selector of the element')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'hover_element', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: `Hover performed: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error on hover: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'scroll_to',
    'Scroll the page to an element or position.',
    {
      selector: z.string().optional().describe('CSS selector of the element'),
      x: z.number().optional().describe('X position in pixels'),
      y: z.number().optional().describe('Y position in pixels')
    },
    async ({ selector, x, y }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      const data = selector ? { selector } : { position: { x, y } };

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'scroll_to', data }, 5000);
        return { content: [{ type: 'text', text: `Scroll performed: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error scrolling: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'press_key',
    `Press a keyboard key. Useful for:
- Confirming actions (Enter)
- Canceling/closing modals (Escape)
- Navigating between fields (Tab)
- Navigating in lists (ArrowUp, ArrowDown)
- Deleting text (Backspace, Delete)

SUPPORTED KEYS:
Enter, Escape, Tab, Backspace, Delete, Space,
ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
Home, End, PageUp, PageDown

EXAMPLES:
- Confirm search: { key: "Enter" }
- Close modal: { key: "Escape" }
- Next field: { key: "Tab" }
- Ctrl+A: { key: "a", modifiers: { ctrl: true } }`,
    {
      key: z.string().describe('Key to press (Enter, Escape, Tab, ArrowDown, etc.)'),
      selector: z.string().optional().describe('Element selector (optional, uses focused element if not provided)'),
      modifiers: z.object({
        ctrl: z.boolean().optional(),
        shift: z.boolean().optional(),
        alt: z.boolean().optional(),
        meta: z.boolean().optional()
      }).optional().describe('Modifiers (ctrl, shift, alt, meta)')
    },
    async ({ key, selector, modifiers }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'press_key', data: { key, selector, modifiers } }, 5000);
        return { content: [{ type: 'text', text: `Key pressed: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error pressing key: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'focus_element',
    'Focus on a page element. Useful before using press_key.',
    {
      selector: z.string().describe('CSS selector of the element')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'focus_element', data: { selector } }, 5000);
        return { content: [{ type: 'text', text: `Element focused: ${JSON.stringify(result)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_active_element',
    'Returns information about the currently focused element on the page.',
    {},
    async (_params, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_active_element', data: {} }, 5000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  mcpServer.tool(
    'get_element_info',
    `Returns detailed information about a specific element.

USEFUL FOR:
- Discovering alternative selectors for an element
- Checking if element is visible, enabled, focused
- Getting data-*, aria-* attributes
- Understanding element structure before interacting

RETURNS:
- tagName, id, className, name, type, value
- data-* and ARIA attributes
- States (isVisible, isEnabled, isChecked, isFocused)
- Position and size
- Alternative selectors

EXAMPLE:
{ selector: "span[title='Username']" }`,
    {
      selector: z.string().describe('CSS selector of the element')
    },
    async ({ selector }, extra) => {
      const session = getSessionOrError(sessionManager, extra.sessionId);
      if ('error' in session) {
        return { content: [{ type: 'text', text: session.error }] };
      }

      try {
        const result = await bridgeServer.sendAndWaitToSession(session.browserSessionId, { type: 'get_element_info', data: { selector } }, 10000);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );
}
