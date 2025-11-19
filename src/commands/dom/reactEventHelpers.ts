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
 * Simple click implementation that works with buttons, links, and custom components.
 * When selector matches multiple elements, prioritizes visible ones.
 */
export const CLICK_ELEMENT_SCRIPT = `
(function(selector) {
  let el = document.querySelector(selector);
  
  if (!el) {
    return {
      success: false,
      error: 'Element not found',
      selector: selector
    };
  }
  
  const allMatches = document.querySelectorAll(selector);
  if (allMatches.length > 1) {
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
  
  const el = elements[index - 1]; // Convert to 0-based
  
  function buildUniquePath(element: Element): string {
    if (element.id) {
      return \`#\${CSS.escape(element.id)}\`;
    }
    
    const path: string[] = [];
    let current: Element | null = element;
    
    while (current && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children);
        const sameTagSiblings = siblings.filter(
          (sibling) => sibling.tagName === current!.tagName
        );
        
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          selector += \`:nth-of-type(\${index})\`;
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
    }
    
    return 'html > ' + path.join(' > ');
  }
  
  const uniqueSelector = buildUniquePath(el);
  
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
