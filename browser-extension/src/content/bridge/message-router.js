/**
 * Message handler routing for content script
 * Maps message types to their handler functions
 */

import { interceptDialogs, stopInterceptingDialogs, handleGetLastDialog, handleGetDialogQueue, handleClearDialogQueue, handleSetDialogAutoAccept } from '../handlers/dialog.js';
import { handleNavigateTo, handleGoBack, handleGoForward, handleRefresh, handleGetCurrentUrl } from '../handlers/navigation.js';
import { handleGetPageInfo, handleGetPageTitle, handleGetPageText, handleGetPageHtml, handleExtractLinks, handleGetPageSnapshot } from '../handlers/page-info.js';
import { handleClickElement, handleDoubleClick, handleHoverElement, handlePressKey, handleTypeText, handleFocusElement, handleGetActiveElement, handleScrollTo } from '../handlers/interaction.js';
import { handleFillField, handleFillForm, handleSelectOption, handleExtractFormData } from '../handlers/form.js';
import { handleWaitForElement, handleWaitForText } from '../handlers/wait.js';
import { handleExtractText, handleExtractTable, handleExtractHtml, handleExtractStyles, handleGetStylesheets } from '../handlers/extraction.js';
import { handleValidatePage } from '../handlers/validation.js';
import { handleExecuteScript } from '../handlers/script.js';
import { handleGetElementInfo } from '../handlers/element-info.js';
import { handleBatchActions } from '../handlers/batch.js';
import { handleGetAccessibilityTree, handleFindByRole, handleHighlightElement, handleGetElementCenter } from '../handlers/accessibility.js';
import { handleSmartWait, handlePageReady, handleRetryAction } from '../handlers/smart-wait.js';

/**
 * Route a message to the appropriate handler
 * Returns the handler result
 */
export async function routeMessage(type, data, sessionId) {
  switch (type) {
    // Navigation
    case 'navigate_to':
      return await handleNavigateTo(data);
    case 'go_back':
      return await handleGoBack();
    case 'go_forward':
      return await handleGoForward();
    case 'refresh':
      return await handleRefresh();
    case 'get_current_url':
      return handleGetCurrentUrl();

    // Page information
    case 'get_page_info':
      return handleGetPageInfo(sessionId);
    case 'get_page_title':
      return handleGetPageTitle();
    case 'get_page_text':
      return handleGetPageText(data);
    case 'get_page_html':
      return handleGetPageHtml(data);

    // DOM interaction
    case 'fill_field':
      return await handleFillField(data);
    case 'fill_form':
      return await handleFillForm(data);
    case 'click_element':
      return await handleClickElement(data);
    case 'select_option':
      return await handleSelectOption(data);
    case 'hover_element':
      return await handleHoverElement(data);
    case 'type_text':
      return await handleTypeText(data);
    case 'scroll_to':
      return await handleScrollTo(data);

    // Wait
    case 'wait_for_element':
      return await handleWaitForElement(data);
    case 'wait_for_text':
      return await handleWaitForText(data);

    // Extraction
    case 'extract_text':
      return handleExtractText(data);
    case 'extract_table':
      return handleExtractTable(data);
    case 'extract_links':
      return handleExtractLinks(data);
    case 'extract_form_data':
      return handleExtractFormData(data);

    // CSS and validation
    case 'extract_styles':
      return handleExtractStyles(data);
    case 'extract_html':
      return handleExtractHtml(data);
    case 'validate_page':
      return handleValidatePage(data);
    case 'get_stylesheets':
      return handleGetStylesheets();

    // Dialog handling
    case 'get_last_dialog':
      return handleGetLastDialog();
    case 'get_dialog_queue':
      return handleGetDialogQueue();
    case 'clear_dialog_queue':
      return handleClearDialogQueue();
    case 'set_dialog_auto_accept':
      return handleSetDialogAutoAccept(data);

    // Advanced interaction
    case 'press_key':
      return await handlePressKey(data);
    case 'get_element_info':
      return handleGetElementInfo(data);
    case 'double_click':
      return await handleDoubleClick(data);
    case 'focus_element':
      return await handleFocusElement(data);
    case 'get_active_element':
      return handleGetActiveElement();

    // Script execution
    case 'execute_script':
      return await handleExecuteScript(data);

    // Batch operations
    case 'batch_actions':
      return await handleBatchActions(data);

    // Page snapshot
    case 'get_page_snapshot':
      return handleGetPageSnapshot();

    // Accessibility
    case 'get_accessibility_tree':
      return handleGetAccessibilityTree(data);
    case 'find_by_role':
      return handleFindByRole(data);

    // Smart wait
    case 'smart_wait':
      return await handleSmartWait(data);
    case 'page_ready':
      return await handlePageReady(data);

    // Highlight and debug
    case 'highlight_element':
      return await handleHighlightElement(data);
    case 'retry_action':
      return await handleRetryAction(data);
    case 'get_element_center':
      return handleGetElementCenter(data);

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// Re-export dialog functions for bridge initialization and cleanup
export { interceptDialogs, stopInterceptingDialogs };
