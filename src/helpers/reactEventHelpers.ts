/**
 * React-compatible event handling for form interactions.
 *
 * React uses synthetic events and doesn't detect direct DOM manipulation.
 * This module provides JavaScript snippets that can be injected via Runtime.evaluate
 * to properly trigger React's event system.
 */

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
  const el = document.querySelector(selector);
  
  if (!el) {
    return { 
      success: false, 
      error: 'Element not found',
      selector: selector
    };
  }
  
  // Check if element is fillable
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
  
  // Focus element first
  el.focus();
  
  // Handle different input types
  if (tagName === 'select') {
    // For select elements
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (inputType === 'checkbox' || inputType === 'radio') {
    // For checkbox/radio, value should be "true" or "false"
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
    // For contenteditable elements
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // For text inputs, use native setter (React compatibility)
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
    
    // Dispatch events that React/Vue/Angular listen for
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  // Blur if requested (triggers validation in many forms)
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
 * JavaScript function to click an element.
 *
 * @remarks
 * Simple click implementation that works with buttons, links, and custom components.
 */
export const CLICK_ELEMENT_SCRIPT = `
(function(selector, options) {
  const el = document.querySelector(selector);
  
  if (!el) {
    return {
      success: false,
      error: 'Element not found',
      selector: selector
    };
  }
  
  // Check if element is clickable (has click handler or is a button/link)
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
  
  // Scroll element into view first
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  
  // Click the element
  el.click();
  
  return {
    success: true,
    selector: selector,
    elementType: tagName,
    clickable: isClickable
  };
})
`;

/**
 * JavaScript function to get multiple elements by selector.
 *
 * @remarks
 * Used when --index is specified to select from multiple matches.
 */
export const GET_ELEMENT_BY_INDEX_SCRIPT = `
(function(selector, index) {
  const elements = document.querySelectorAll(selector);
  
  if (elements.length === 0) {
    return {
      success: false,
      error: 'No elements found',
      selector: selector,
      matchCount: 0
    };
  }
  
  if (index < 1 || index > elements.length) {
    return {
      success: false,
      error: 'Index out of range',
      selector: selector,
      matchCount: elements.length,
      requestedIndex: index,
      suggestion: \`Use --index between 1 and \${elements.length}\`
    };
  }
  
  // Return element info (we'll use this to build a more specific selector)
  const el = elements[index - 1]; // Convert to 0-based
  const tagName = el.tagName.toLowerCase();
  const id = el.id;
  const classes = Array.from(el.classList).join('.');
  
  // Build a unique selector
  let uniqueSelector = tagName;
  if (id) {
    uniqueSelector = \`#\${id}\`;
  } else if (classes) {
    uniqueSelector = \`\${tagName}.\${classes}\`;
  } else {
    // Use nth-child as fallback
    const parent = el.parentElement;
    const siblings = Array.from(parent?.children || []);
    const childIndex = siblings.indexOf(el) + 1;
    uniqueSelector = \`\${tagName}:nth-child(\${childIndex})\`;
  }
  
  return {
    success: true,
    selector: selector,
    matchCount: elements.length,
    selectedIndex: index,
    uniqueSelector: uniqueSelector
  };
})
`;

/**
 * Options for filling an element.
 */
export interface FillOptions {
  /** Whether to blur the element after filling (default: true) */
  blur?: boolean;
  /** Index to use if selector matches multiple elements (1-based) */
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
}

/**
 * Result of getting element by index.
 */
export interface ElementByIndexResult {
  success: boolean;
  error?: string;
  selector?: string;
  matchCount?: number;
  selectedIndex?: number;
  requestedIndex?: number;
  uniqueSelector?: string;
  suggestion?: string;
}
