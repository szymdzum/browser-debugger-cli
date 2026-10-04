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
(function(selector, parts, value, options) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector, parts);
  const warnings = [];
  // Why a user could not reach the field (the value is still set, so scripted
  // flows keep working, but the result may not be what a user would see)
  const unreachableReason = (field) => {
    if (field.closest('[inert]')) return 'inert';
    const modal = field.ownerDocument.querySelector('dialog:modal');
    if (modal && !modal.contains(field)) return 'behind an open modal dialog';
    if (field.checkVisibility && !field.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return 'hidden';
    return null;
  };
  // Why the browser did not take the value as given (it sanitizes instead of
  // throwing: bad dates become "", colors #000000, ranges are clamped)
  const rejectedValue = (field, type, text) => {
    const formats = {
      number: 'a number',
      date: 'YYYY-MM-DD',
      time: 'HH:MM',
      'datetime-local': 'YYYY-MM-DDTHH:MM',
      month: 'YYYY-MM',
      week: 'YYYY-Www'
    };
    const rejected = 'The browser rejected "' + text + '" for a ' + type + ' field (it keeps its previous value)';
    if (formats[type] && text.trim() !== '' && field.value === '') {
      return { error: rejected, suggestion: 'Expected ' + formats[type] };
    }
    if (type === 'color' && field.value.toLowerCase() !== text.trim().toLowerCase()) {
      return { error: rejected, suggestion: 'Expected a hex color like #1a2b3c' };
    }
    if (type === 'range' && Number(field.value) !== Number(text)) {
      return {
        error: 'The browser would set ' + field.value + ' instead of "' + text + '" (range ' + (field.min || 0) + ' to ' + (field.max || 100) + ', step ' + (field.step || 1) + ')',
        suggestion: 'Use a value within the range that matches the step'
      };
    }
    return null;
  };
  
  if (allMatches.length === 0) {
    return { 
      success: false, 
      error: 'Element not found: ' + selector,
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

  if (el.disabled || el.matches(':disabled')) {
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

  const unreachable = unreachableReason(el);
  if (unreachable) {
    warnings.push('The field is ' + unreachable + '; a user could not fill it (the value was set anyway)');
  }

  el.focus();

  if (tagName === 'select' && el.multiple) {
    // Several options, separated by commas (an option whose value contains a
    // comma matches as a whole); "" selects none
    const options = Array.from(el.options);
    const whole = options.some((o) => o.value === value || o.text.trim() === value);
    const wanted = whole ? [value] : value.split(',').map((part) => part.trim()).filter(Boolean);
    const chosen = wanted.map((part) =>
      options.find((o) => o.value === part) || options.find((o) => o.text.trim() === part)
    );
    const missing = wanted.find((part, i) => !chosen[i]);
    if (missing !== undefined) {
      return {
        success: false,
        error: 'Option not found: ' + missing,
        exitCode: 81,
        elementType: tagName,
        suggestion: 'Available options: ' + options.slice(0, 10).map((o) => o.value || o.text.trim()).join(', ')
      };
    }
    options.forEach((o) => { o.selected = chosen.includes(o); });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (tagName === 'select') {
    // Match by option value first, then by visible label
    const options = Array.from(el.options);
    const option =
      options.find((o) => o.value === value) ||
      options.find((o) => o.text.trim() === value);
    if (!option) {
      return {
        success: false,
        error: 'Option not found: ' + value,
        exitCode: 81,
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
    const normalized = String(value).trim().toLowerCase();
    const truthy = ['true', '1', 'yes', 'on', 'checked'];
    const falsy = ['false', '0', 'no', 'off', 'unchecked'];
    if (!truthy.includes(normalized) && !falsy.includes(normalized)) {
      return {
        success: false,
        error: 'Expected true or false for a ' + inputType + ', got "' + value + '"',
        elementType: tagName,
        inputType: inputType,
        suggestion: 'Use true/false (also yes/no, on/off, 1/0)'
      };
    }
    const shouldCheck = truthy.includes(normalized);
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
      fileInput: true,
      elementType: tagName,
      inputType: inputType,
      error: 'File input'
    };
  } else if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.ownerDocument.defaultView.HTMLInputElement.prototype,
      'value'
    )?.set;
    
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      el.ownerDocument.defaultView.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    
    const setter = tagName === 'textarea' 
      ? nativeTextAreaValueSetter 
      : nativeInputValueSetter;

    if (el.maxLength > 0 && value.length > el.maxLength) {
      return {
        success: false,
        error: 'Value is ' + value.length + ' characters; the field accepts at most ' + el.maxLength,
        elementType: tagName,
        inputType: inputType || null,
        suggestion: 'Shorten the value (a user could not type more than maxlength characters)'
      };
    }
    
    const setValue = (text) => (setter ? setter.call(el, text) : (el.value = text));
    const previous = el.value;
    setValue(value);
    const rejection = rejectedValue(el, inputType, value);
    if (rejection) {
      setValue(previous);
      if (options.blur !== false) el.blur();
      return {
        success: false,
        error: rejection.error,
        elementType: tagName,
        inputType: inputType,
        suggestion: rejection.suggestion
      };
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.validity && (el.validity.rangeOverflow || el.validity.rangeUnderflow)) {
      warnings.push('The value is outside the allowed range (' + (el.min || 'no minimum') + ' to ' + (el.max || 'no maximum') + '); the form will not submit until it is fixed');
    }
  }
  
  if (options.blur !== false) {
    el.blur();
  }
  
  return {
    success: true,
    selector: selector,
    value: el.isContentEditable
      ? el.textContent
      : inputType === 'password'
        ? '********'
        : tagName === 'select' && el.multiple
          ? Array.from(el.selectedOptions).map((o) => o.value).join(', ')
          : el.value,
    elementType: tagName,
    inputType: inputType || null,
    checked: inputType === 'checkbox' || inputType === 'radio' ? el.checked : undefined,
    matchCount: allMatches.length,
    warning: warnings.concat(allMatches.length > 1 && typeof index !== 'number'
      ? [allMatches.length + ' elements match; filled the first (use --index or a more specific selector)']
      : []).join('; ') || undefined
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
(function(selector, parts, index, action) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector, parts);
  
  if (allMatches.length === 0) {
    return {
      success: false,
      error: 'Element not found: ' + selector,
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
      const style = candidate.ownerDocument.defaultView.getComputedStyle(candidate);
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
  if (tagName === 'option') {
    const quote = (text) => "'" + String(text).split("'").join("'\\\\''") + "'";
    const select = el.closest('select');
    const target = select && select.id ? '#' + select.id : select && select.name ? 'select[name="' + select.name + '"]' : 'select';
    return {
      success: false,
      error: 'An <option> is chosen through its <select>, not clicked',
      selector: selector,
      elementType: tagName,
      exitCode: 81,
      suggestion: 'bdg dom fill ' + quote(target) + ' ' + quote(el.value || el.text.trim())
    };
  }
  // Disabled elements still get hover (tooltips often explain why)
  if (action !== 'hover' && (el.disabled || el.matches(':disabled'))) {
    return {
      success: false,
      error: 'Element is disabled',
      selector: selector,
      elementType: tagName,
      suggestion: 'A user cannot click a disabled element; enable it first (it may depend on other fields)'
    };
  }
  el.scrollIntoView({ behavior: 'auto', block: 'center' });

  // The caller clicks with real mouse events at (x, y) when the element is the
  // topmost thing there; otherwise it falls back to el.click() via this handle.
  // Hit-testing happens in the element's own root (shadow root or frame
  // document), then in each enclosing document at the frame's position, so an
  // overlay over the iframe counts as covering it. The mouse events need
  // top-page coordinates: frame offsets (border and padding) are added.
  window.__bdgClickTarget = el;
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  const hitTest = (node, px, py) => {
    const root = node.getRootNode();
    const hit = (typeof root.elementFromPoint === 'function' ? root : node.ownerDocument).elementFromPoint(px, py);
    return hit !== null && (hit === node || node.contains(hit));
  };
  const toTopPage = (px, py) => {
    let hittable = hitTest(el, px, py);
    for (let frameWindow = view; frameWindow && frameWindow.frameElement; frameWindow = frameWindow.parent) {
      const frame = frameWindow.frameElement;
      const frameRect = frame.getBoundingClientRect();
      const frameStyle = frame.ownerDocument.defaultView.getComputedStyle(frame);
      px += frameRect.left + frame.clientLeft + parseFloat(frameStyle.paddingLeft);
      py += frameRect.top + frame.clientTop + parseFloat(frameStyle.paddingTop);
      hittable = hittable && hitTest(frame, px, py);
    }
    return { x: px, y: py, hittable: hittable };
  };
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, view.innerWidth);
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, view.innerHeight);
  const area = right > left && bottom > top
    ? { left: left, top: top, width: right - left, height: bottom - top }
    : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const fractions = [[0.5, 0.5], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  const hasSize = rect.width > 0 && rect.height > 0;
  let point = null;
  for (const [fx, fy] of hasSize ? fractions : [[0.5, 0.5]]) {
    const candidate = toTopPage(area.left + area.width * fx, area.top + area.height * fy);
    point = point || candidate;
    if (hasSize && candidate.hittable) { point = candidate; break; }
  }
  const x = point.x;
  const y = point.y;
  const hittable = hasSize && point.hittable;
  const describe = (node) => node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
    (node.classList && node.classList.length ? '.' + Array.from(node.classList).slice(0, 2).join('.') : '');
  const coveredBy = () => {
    const root = el.getRootNode();
    const hit = (typeof root.elementFromPoint === 'function' ? root : el.ownerDocument)
      .elementFromPoint(area.left + area.width / 2, area.top + area.height / 2);
    return hit && !el.contains(hit) ? ' (' + describe(hit) + ')' : '';
  };
  const style = view.getComputedStyle(el);
  let obstruction = null;
  if (style.display === 'none' || el.getClientRects().length === 0) obstruction = 'not rendered (display: none)';
  else if (style.visibility === 'hidden') obstruction = 'hidden (visibility: hidden)';
  else if (el.closest('[inert]')) obstruction = 'inert (the page made it non-interactive)';
  else if (style.pointerEvents === 'none') obstruction = 'not clickable (pointer-events: none)';
  else if (!hasSize) obstruction = 'zero-size';
  else if (!hittable) obstruction = 'covered by another element' + coveredBy();

  return {
    success: true,
    selector: selector,
    elementType: tagName,
    matchCount: allMatches.length,
    selectedIndex: typeof index === 'number' ? index : undefined,
    x: x,
    y: y,
    hittable: hittable,
    obstruction: obstruction
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
  /** Directory relative file paths are resolved against (file inputs) */
  cwd?: string;
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
