/**
 * React-compatible event handling for form interactions.
 *
 * React uses synthetic events and doesn't detect direct DOM manipulation.
 * This module provides JavaScript snippets that can be injected via Runtime.evaluate
 * to properly trigger React's event system.
 */

import type { FillResult, ClickResult } from '@/ipc/protocol/domTypes.js';
import { FIND_ELEMENTS_JS } from '@/runtime/dom/targetNode.js';

/**
 * JavaScript function to fill an input element in a React-compatible way.
 *
 * This approach:
 * 1. Uses native property setters to bypass React's value tracking
 * 2. Dispatches input/change events that React listens for
 * 3. Properly handles focus/blur for form validation
 *
 * @remarks
 * Works with React, Vue, Angular, and vanilla JS applications.
 */
export const REACT_FILL_SCRIPT = `
(function(selector, value, options) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector);
  
  if (allMatches.length === 0) {
    return { 
      success: false, 
      error: 'Element not found',
      selector: selector
    };
  }
  
  let el;
  const index = options.index;
  
  // If index is provided, use it directly (0-based)
  if (typeof index === 'number' && index >= 0) {
    if (index >= allMatches.length) {
      return {
        success: false,
        error: 'Index out of range',
        selector: selector,
        matchCount: allMatches.length,
        requestedIndex: index,
        suggestion: 'Use --index between 0 and ' + (allMatches.length - 1)
      };
    }
    el = allMatches[index];
  } else {
    el = allMatches[0];
  }
  
  const tagName = el.tagName.toLowerCase();
  const inputType = el.type?.toLowerCase();
  
  const isFillable = (
    tagName === 'input' || 
    tagName === 'textarea' || 
    tagName === 'select' ||
    el.isContentEditable
  );
  
  if (!isFillable) {
    return {
      success: false,
      error: 'Element is not fillable',
      elementType: tagName,
      suggestion: 'Only input, textarea, select, and contenteditable elements can be filled'
    };
  }

  if (el.disabled) {
    return {
      success: false,
      error: 'Element is disabled',
      elementType: tagName,
      suggestion: 'Enable the field first (it may depend on another input)'
    };
  }
  if (el.readOnly) {
    return {
      success: false,
      error: 'Element is read-only',
      elementType: tagName,
      suggestion: 'Read-only fields cannot be filled'
    };
  }

  el.focus();

  if (tagName === 'select') {
    // Match by option value first, then by visible label
    const options = Array.from(el.options);
    const option =
      options.find((o) => o.value === value) ||
      options.find((o) => o.text.trim() === value);
    if (!option) {
      return {
        success: false,
        error: 'Option not found: ' + value,
        elementType: tagName,
        suggestion: 'Available options: ' + options.slice(0, 10).map((o) => o.value || o.text.trim()).join(', ')
      };
    }
    el.value = option.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (inputType === 'checkbox' || inputType === 'radio') {
    // Toggle through a click, like a user: frameworks (React) track checkable
    // state via click events and revert a programmatic \`checked\` assignment
    const shouldCheck = value === 'true';
    if (inputType === 'radio' && !shouldCheck) {
      return {
        success: false,
        error: 'A radio button cannot be unchecked',
        elementType: tagName,
        inputType: inputType,
        suggestion: 'Select another option in the same group instead'
      };
    }
    if (el.checked !== shouldCheck) {
      el.click();
    }
  } else if (inputType === 'file') {
    return {
      success: false,
      error: 'File inputs require CDP DOM.setFileInputFiles method',
      suggestion: 'Use: bdg cdp DOM.setFileInputFiles --params {\\"files\\":[\\"path\\"]}'
    };
  } else if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    
    const setter = tagName === 'textarea' 
      ? nativeTextAreaValueSetter 
      : nativeInputValueSetter;
    
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  if (options.blur !== false) {
    el.blur();
  }
  
  return {
    success: true,
    selector: selector,
    value: el.value || el.textContent,
    elementType: tagName,
    inputType: inputType || null,
    checked: el.checked || undefined
  };
})
`;

/**
 * JavaScript function to locate an element for clicking.
 *
 * Scrolls the element into view and reports its center point and whether it
 * is the topmost element there (`hittable`). It does not click; see
 * `clickElement`, which dispatches real mouse events or falls back to
 * `el.click()`.
 *
 * @remarks
 * Handles both direct selector matching and indexed selection.
 * When index is provided, selects the nth matching element (0-based).
 * When selector matches multiple elements without index, prioritizes visible ones.
 */
export const CLICK_ELEMENT_SCRIPT = `
(function(selector, index) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector);
  
  if (allMatches.length === 0) {
    return {
      success: false,
      error: 'Element not found',
      selector: selector
    };
  }
  
  let el;
  
  // If index is provided, use it directly (0-based)
  if (typeof index === 'number' && index >= 0) {
    if (index >= allMatches.length) {
      return {
        success: false,
        error: 'Index out of range',
        selector: selector,
        matchCount: allMatches.length,
        requestedIndex: index,
        suggestion: 'Use --index between 0 and ' + (allMatches.length - 1)
      };
    }
    el = allMatches[index];
  } else if (allMatches.length === 1) {
    // Single match - use it directly
    el = allMatches[0];
  } else {
    // Multiple matches without index - find first visible one
    el = allMatches[0];
    for (const candidate of allMatches) {
      const style = window.getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      
      const hasSize = rect.width > 0 && rect.height > 0;
      const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden';
      const isOpaque = parseFloat(style.opacity) > 0;
      const isPositioned = candidate.offsetParent !== null || style.position === 'fixed';
      
      const isVisible = hasSize && isDisplayed && isOpaque && isPositioned;
      
      if (isVisible) {
        el = candidate;
        break;
      }
    }
  }
  
  const tagName = el.tagName.toLowerCase();
  const isClickable = (
    tagName === 'button' ||
    tagName === 'a' ||
    tagName === 'input' ||
    el.onclick !== null ||
    el.getAttribute('role') === 'button' ||
    window.getComputedStyle(el).cursor === 'pointer'
  );
  
  el.scrollIntoView({ behavior: 'auto', block: 'center' });

  // The caller clicks with real mouse events at (x, y) when the element is the
  // topmost thing there; otherwise it falls back to el.click() via this handle.
  window.__bdgClickTarget = el;
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const top = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(x, y) : null;
  const hittable = top !== null && (top === el || el.contains(top));

  return {
    success: true,
    selector: selector,
    elementType: tagName,
    clickable: isClickable,
    matchCount: allMatches.length,
    selectedIndex: typeof index === 'number' ? index : undefined,
    x: x,
    y: y,
    hittable: hittable
  };
})
`;

/**
 * Options for filling an element.
 */
export interface FillOptions {
  /** Whether to blur the element after filling (default: true) */
  blur?: boolean;
  /** Index to use if selector matches multiple elements (0-based) */
  index?: number;
}

export type { FillResult, ClickResult } from '@/ipc/protocol/domTypes.js';

/**
 * Type guard for FillResult.
 *
 * @param value - Value to check
 * @returns True if value is a valid FillResult
 */
export function isFillResult(value: unknown): value is FillResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['success'] === 'boolean';
}

/**
 * Type guard for ClickResult.
 *
 * @param value - Value to check
 * @returns True if value is a valid ClickResult
 */
export function isClickResult(value: unknown): value is ClickResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['success'] === 'boolean';
}
