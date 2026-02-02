/**
 * Zod Schemas for MCP tool validation
 */

import { z } from 'zod';

// Navigation
export const NavigateToSchema = z.object({
  url: z.string().url('URL inválida')
});

// Selectors
export const SelectorOrLabelSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional()
}).refine(data => data.selector || data.label, {
  message: 'Forneça selector ou label'
});

// Form fields
export const FillFieldSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional(),
  value: z.string()
}).refine(data => data.selector || data.label, {
  message: 'Forneça selector ou label'
});

export const FillFormSchema = z.object({
  fields: z.array(z.object({
    selector: z.string().optional(),
    label: z.string().optional(),
    value: z.string()
  }))
});

// Click
export const ClickElementSchema = z.object({
  selector: z.string().optional(),
  text: z.string().optional()
}).refine(data => data.selector || data.text, {
  message: 'Forneça selector ou text'
});

// Select
export const SelectOptionSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional()
});

// Wait
export const WaitForElementSchema = z.object({
  selector: z.string(),
  timeout: z.number().optional().default(10000)
});

export const WaitForTextSchema = z.object({
  text: z.string(),
  selector: z.string().optional(),
  timeout: z.number().optional().default(10000)
});

// Extraction
export const ExtractTextSchema = z.object({
  selector: z.string()
});

export const ExtractTableSchema = z.object({
  selector: z.string().optional()
});

export const ExtractStylesSchema = z.object({
  selector: z.string().optional(),
  includeComputed: z.boolean().optional().default(true),
  includeInline: z.boolean().optional().default(true),
  includeClasses: z.boolean().optional().default(true)
});

export const ExtractHtmlSchema = z.object({
  selector: z.string().optional(),
  outerHtml: z.boolean().optional().default(true)
});

// Validation
export const ValidatePageSchema = z.object({
  selector: z.string().optional(),
  rules: z.array(z.object({
    type: z.enum(['element_exists', 'element_count', 'has_class', 'has_style', 'has_attribute', 'text_contains', 'text_equals']),
    selector: z.string(),
    expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
    property: z.string().optional(),
    description: z.string().optional()
  })).optional()
});

// Type text
export const TypeTextSchema = z.object({
  selector: z.string().optional(),
  label: z.string().optional(),
  text: z.string(),
  delay: z.number().optional().default(50)
}).refine(data => data.selector || data.label, {
  message: 'Forneça selector ou label'
});

// Scroll
export const ScrollToSchema = z.object({
  selector: z.string().optional(),
  position: z.object({
    x: z.number().optional(),
    y: z.number().optional()
  }).optional()
});

// Page info with lazy loading
export const GetPageInfoSchema = z.object({
  includeForms: z.boolean().optional().default(true),
  includeButtons: z.boolean().optional().default(true),
  includeLinks: z.boolean().optional().default(true),
  includeInputs: z.boolean().optional().default(true),
  includeClickable: z.boolean().optional().default(true),
  maxElements: z.number().optional().default(100)
});

// Batch actions
export const BatchActionsSchema = z.object({
  actions: z.array(z.object({
    type: z.string(),
    data: z.record(z.any()).optional()
  })).min(1).max(20),
  stopOnError: z.boolean().optional().default(true)
});

// Smart wait
export const SmartWaitSchema = z.object({
  conditions: z.array(z.object({
    type: z.enum(['element', 'text', 'url_contains', 'url_equals', 'url_matches', 'network_idle', 'no_loading_spinner', 'element_hidden', 'element_enabled', 'document_ready', 'dom_stable', 'element_count', 'attribute_equals', 'element_text']),
    selector: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    pattern: z.string().optional(),
    duration: z.number().optional(),
    count: z.number().optional(),
    operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']).optional(),
    attribute: z.string().optional(),
    exact: z.boolean().optional(),
    state: z.string().optional()
  })).min(1),
  logic: z.enum(['all', 'any']).optional().default('all'),
  timeout: z.number().optional().default(10000),
  pollInterval: z.number().optional().default(100)
});

// Accessibility
export const GetAccessibilityTreeSchema = z.object({
  maxDepth: z.number().optional().default(5),
  roles: z.array(z.string()).optional(),
  root: z.string().optional()
});

export const FindByRoleSchema = z.object({
  role: z.string(),
  name: z.string().optional()
});

// Highlight
export const HighlightElementSchema = z.object({
  selector: z.string(),
  color: z.string().optional().default('red'),
  duration: z.number().optional().default(2000)
});

// Retry
export const RetryActionSchema = z.object({
  action: z.object({
    type: z.string(),
    data: z.record(z.any()).optional()
  }),
  maxAttempts: z.number().optional().default(3),
  delayMs: z.number().optional().default(1000),
  backoff: z.boolean().optional().default(false)
});

// Element center
export const GetElementCenterSchema = z.object({
  selector: z.string()
});

// Page ready
export const PageReadySchema = z.object({
  timeout: z.number().optional().default(30000),
  checkNetwork: z.boolean().optional().default(true),
  checkSpinners: z.boolean().optional().default(true),
  stabilityDuration: z.number().optional().default(500)
});
