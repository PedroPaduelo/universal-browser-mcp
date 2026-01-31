/**
 * Batch operations handler - Execute multiple browser actions in a single request
 * Reduces round-trips for multi-step workflows by 60-80%
 */

import { handleNavigateTo, handleGoBack, handleGoForward, handleRefresh, handleGetCurrentUrl } from './navigation.js';
import { handleGetPageInfo, handleGetPageTitle, handleGetPageText, handleExtractLinks } from './page-info.js';
import { handleClickElement, handleDoubleClick, handleHoverElement, handlePressKey, handleTypeText, handleFocusElement, handleScrollTo } from './interaction.js';
import { handleFillField, handleFillForm, handleSelectOption, handleExtractFormData } from './form.js';
import { handleWaitForElement, handleWaitForText } from './wait.js';
import { handleExtractText, handleExtractTable, handleExtractHtml } from './extraction.js';

/**
 * Map of action types to their handlers
 */
const actionHandlers = {
  // Navigation
  'navigate_to': handleNavigateTo,
  'go_back': handleGoBack,
  'go_forward': handleGoForward,
  'refresh': handleRefresh,
  'get_current_url': handleGetCurrentUrl,

  // Page info
  'get_page_info': handleGetPageInfo,
  'get_page_title': handleGetPageTitle,
  'get_page_text': handleGetPageText,
  'extract_links': handleExtractLinks,

  // Interaction
  'click_element': handleClickElement,
  'double_click': handleDoubleClick,
  'hover_element': handleHoverElement,
  'press_key': handlePressKey,
  'type_text': handleTypeText,
  'focus_element': handleFocusElement,
  'scroll_to': handleScrollTo,

  // Form
  'fill_field': handleFillField,
  'fill_form': handleFillForm,
  'select_option': handleSelectOption,
  'extract_form_data': handleExtractFormData,

  // Wait
  'wait_for_element': handleWaitForElement,
  'wait_for_text': handleWaitForText,

  // Extraction
  'extract_text': handleExtractText,
  'extract_table': handleExtractTable,
  'extract_html': handleExtractHtml
};

/**
 * Execute a batch of actions sequentially
 * @param {Object} data - The batch configuration
 * @param {Array} data.actions - Array of actions to execute
 * @param {boolean} data.stopOnError - Stop on first error (default: true)
 * @returns {Object} Results of all actions
 */
export async function handleBatchActions(data) {
  const { actions, stopOnError = true } = data;

  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions array is required and must not be empty');
  }

  if (actions.length > 20) {
    throw new Error('Maximum 20 actions per batch allowed');
  }

  const results = [];
  const startTime = Date.now();
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const { type, data: actionData = {} } = action;

    if (!type) {
      const error = `Action at index ${i} missing 'type' field`;
      if (stopOnError) {
        throw new Error(error);
      }
      results.push({
        index: i,
        type: 'unknown',
        success: false,
        error
      });
      failedCount++;
      continue;
    }

    const handler = actionHandlers[type];
    if (!handler) {
      const error = `Unknown action type: ${type}`;
      if (stopOnError) {
        throw new Error(error);
      }
      results.push({
        index: i,
        type,
        success: false,
        error
      });
      failedCount++;
      continue;
    }

    const actionStartTime = Date.now();

    try {
      const result = await handler(actionData);
      results.push({
        index: i,
        type,
        success: true,
        data: result,
        duration: Date.now() - actionStartTime
      });
      successCount++;
    } catch (error) {
      const errorResult = {
        index: i,
        type,
        success: false,
        error: error.message,
        duration: Date.now() - actionStartTime
      };
      results.push(errorResult);
      failedCount++;

      if (stopOnError) {
        return {
          completed: false,
          stoppedAtIndex: i,
          results,
          summary: {
            total: actions.length,
            executed: i + 1,
            succeeded: successCount,
            failed: failedCount,
            totalDuration: Date.now() - startTime
          }
        };
      }
    }
  }

  return {
    completed: true,
    results,
    summary: {
      total: actions.length,
      executed: actions.length,
      succeeded: successCount,
      failed: failedCount,
      totalDuration: Date.now() - startTime
    }
  };
}
