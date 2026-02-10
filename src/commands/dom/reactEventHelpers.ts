/**
 * React-compatible event handling for form interactions.
 *
 * React uses synthetic events and doesn't detect direct DOM manipulation.
 * This module provides JavaScript snippets that can be injected via Runtime.evaluate
 * to properly trigger React's event system.
 */

/**
 * JavaScript helper body to query elements with Playwright-style selector support.
 *
 * Supports:
 * - `:has-text("text")` - Element contains text (case-insensitive)
 * - `:text("text")` - Smallest element with text (case-insensitive)
 * - `:text-is("text")` - Exact text match (case-sensitive)
 * - `:visible` - Element is visible
 *
 * This is embedded inside each form interaction script to enable Playwright selectors.
 * Must be defined inside an IIFE to be accessible by the script logic.
 */
const QUERY_ELEMENTS_HELPER_BODY = `
  function __bdgQueryElements(sel) {
    const pseudoMatches = [];
    let cssSelector = sel;

    const hasTextPattern = /:has-text\\((['"])(.*?)\\1\\)/g;
    let match;
    while ((match = hasTextPattern.exec(sel)) !== null) {
      pseudoMatches.push({ type: 'has-text', arg: match[2] });
    }
    cssSelector = cssSelector.replace(hasTextPattern, '');

    const textIsPattern = /:text-is\\((['"])(.*?)\\1\\)/g;
    while ((match = textIsPattern.exec(sel)) !== null) {
      pseudoMatches.push({ type: 'text-is', arg: match[2] });
    }
    cssSelector = cssSelector.replace(textIsPattern, '');

    const textPattern = /:text\\((['"])(.*?)\\1\\)/g;
    while ((match = textPattern.exec(sel)) !== null) {
      pseudoMatches.push({ type: 'text', arg: match[2] });
    }
    cssSelector = cssSelector.replace(textPattern, '');

    if (sel.includes(':visible')) {
      pseudoMatches.push({ type: 'visible' });
      cssSelector = cssSelector.split(':visible').join('');
    }

    cssSelector = cssSelector.replace(/  +/g, ' ').trim() || '*';
    let elements = Array.from(document.querySelectorAll(cssSelector));

    for (const pseudo of pseudoMatches) {
      elements = elements.filter(el => {
        switch (pseudo.type) {
          case 'has-text': {
            const text = pseudo.arg.toLowerCase();
            return el.textContent && el.textContent.toLowerCase().includes(text);
          }
          case 'text': {
            const text = pseudo.arg.toLowerCase();
            const elText = (el.textContent || '').replace(/  +/g, ' ').trim().toLowerCase();
            if (!elText.includes(text)) return false;
            for (const child of el.children) {
              const childText = (child.textContent || '').replace(/  +/g, ' ').trim().toLowerCase();
              if (childText.includes(text)) return false;
            }
            return true;
          }
          case 'text-is': {
            return (el.textContent || '').replace(/  +/g, ' ').trim() === pseudo.arg;
          }
          case 'visible': {
            const style = window.getComputedStyle(el);
            if (style.display === 'none') return false;
            if (style.visibility === 'hidden') return false;
            if (style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          default:
            return true;
        }
      });
    }
    return elements;
  }`;

/**
 * Export for use in other modules that need the helper (e.g., formFillHelpers.ts).
 */
export const QUERY_ELEMENTS_HELPER = QUERY_ELEMENTS_HELPER_BODY;

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
${QUERY_ELEMENTS_HELPER_BODY}
  const allMatches = __bdgQueryElements(selector);
  
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
  
  el.focus();
  
  if (tagName === 'select') {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (inputType === 'checkbox' || inputType === 'radio') {
    const shouldCheck = value === 'true' || value === true;
    el.checked = shouldCheck;
    el.dispatchEvent(new Event('change', { bubbles: true }));
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
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
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
 * JavaScript function to click an element.
 *
 * @remarks
 * Handles both direct selector matching and indexed selection.
 * When index is provided, selects the nth matching element (0-based).
 * When selector matches multiple elements without index, prioritizes visible ones.
 */
export const CLICK_ELEMENT_SCRIPT = `
(function(selector, index) {
${QUERY_ELEMENTS_HELPER_BODY}
  const allMatches = __bdgQueryElements(selector);
  
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
  
  if (!isClickable) {
    console.warn('Warning: Element may not be clickable:', el);
  }
  
  el.scrollIntoView({ behavior: 'auto', block: 'center' });
  
  el.click();
  
  return {
    success: true,
    selector: selector,
    elementType: tagName,
    clickable: isClickable,
    matchCount: allMatches.length,
    selectedIndex: typeof index === 'number' ? index : undefined
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

/**
 * Result of filling an element.
 */
export interface FillResult {
  success: boolean;
  error?: string;
  selector?: string;
  value?: string;
  elementType?: string;
  inputType?: string | null;
  checked?: boolean;
  suggestion?: string;
}

/**
 * Result of clicking an element.
 */
export interface ClickResult {
  success: boolean;
  error?: string;
  selector?: string;
  elementType?: string;
  clickable?: boolean;
  matchCount?: number;
  selectedIndex?: number;
  requestedIndex?: number;
  suggestion?: string;
}

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
