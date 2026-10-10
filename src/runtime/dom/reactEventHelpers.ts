/**
 * React-compatible event handling for form interactions.
 *
 * React uses synthetic events and doesn't detect direct DOM manipulation.
 * This module provides JavaScript snippets that can be injected via Runtime.evaluate
 * to properly trigger React's event system.
 */

import {
  FILL_REFUSALS,
  LABEL_WITHOUT_CONTROL,
  NAME_QUERY_PLACEHOLDER,
  VIA_LABEL_SUFFIX,
} from '@/errors/messages.js';
import type { FillResult, ClickResult } from '@/ipc/protocol/domTypes.js';
import { REVEAL_SNAPSHOT_JS } from '@/runtime/dom/actionEffectsScripts.js';
import { CLEAR_SUBMIT_PROBE_JS, SUBMIT_PROBE_JS } from '@/runtime/dom/blockedSubmit.js';
import { ANCESTOR_CLIP_JS } from '@/runtime/dom/elementGeometry.js';
import {
  DISABLED_CAUSE_JS,
  ELEMENT_DESCRIPTION_JS,
  ELEMENT_IDENTITY_JS,
} from '@/runtime/dom/elementInfo.js';
import { FIND_ELEMENTS_JS, LABEL_CONTROL_JS } from '@/runtime/dom/targetNode.js';
import { FILL_BEFOREINPUT_CANCELLED_WARNING, NO_BOX_CLICK_REASON } from '@/ui/messages/commands.js';

/**
 * Page-side copy of a list (`select.options`, a NodeList) as an array,
 * without `Array.from`, which pages replace.
 */
const LIST_JS = `(list) => {
  const items = [];
  for (let i = 0; i < list.length; i++) items[items.length] = list[i];
  return items;
}`;

/**
 * Page-side read-back of a filled field: a mismatch when its value is not
 * what was asked for (the page rejected, reformatted or moved the input),
 * undefined when it is. Values are compared as the browser normalises them:
 * colors case-insensitively, numbers and ranges as numbers, email trimmed,
 * textarea line endings as `\n`, times and local date-times without zero
 * seconds and with `T` (`2024-01-05 10:00:00` is `2024-01-05T10:00`).
 * Checkboxes and radios compare as `checked`/`unchecked`, a multiple select
 * as its selected values joined by ", ", contenteditable text with
 * whitespace collapsed. A value cut to the field's maxlength sets
 * `truncatedTo`; a password mismatch gives masked values and both lengths.
 */
export const FILL_VALUE_MISMATCH_JS = `(field, expected) => {
  const type = (field.type || '').toLowerCase();
  const actual = field.isContentEditable
    ? (field.textContent || '')
    : type === 'checkbox' || type === 'radio'
      ? (field.checked ? 'checked' : 'unchecked')
      : field.localName === 'select' && field.multiple
        ? (${LIST_JS})(field.selectedOptions).map((o) => o.value).join(', ')
        : String(field.value);
  const time = (text) => text.trim().replace(' ', 'T').replace(/(\\d\\d:\\d\\d):00(\\.0+)?$/, '$1');
  const normalize = (text) => {
    text = String(text);
    if (field.isContentEditable) return text.replace(/\\s+/g, ' ').trim();
    if (field.localName === 'textarea') return text.replace(/\\r\\n?/g, '\\n');
    if (type === 'color') return text.trim().toLowerCase();
    if (type === 'email') return text.trim();
    if (type === 'time' || type === 'datetime-local') return time(text);
    return text;
  };
  const numeric = (type === 'number' || type === 'range') && actual.trim() !== '' && String(expected).trim() !== '';
  const same = numeric ? Number(actual) === Number(expected) : normalize(actual) === normalize(expected);
  if (same) return undefined;
  if (type === 'password') {
    const mask = (text) => (text === '' ? '' : '********');
    return { expected: mask(expected), actual: mask(actual), expectedLength: expected.length, actualLength: actual.length };
  }
  const cut = field.maxLength > 0 && actual.length === field.maxLength && expected.length > actual.length &&
    expected.startsWith(actual);
  return cut ? { expected: expected, actual: actual, truncatedTo: actual.length } : { expected: expected, actual: actual };
}`;

/**
 * Page-side list of the other text-like fields of a field's form (of the
 * document when it has none), with their values: taken before a fill, so
 * {@link MOVED_VALUE_JS} can tell which one the page changed.
 */
export const FIELD_VALUES_JS = `(field) => {
  const fields = field.form ? Array.from(field.form.elements) : Array.from(field.ownerDocument.querySelectorAll('input, textarea'));
  return new Map(fields
    .filter((f) => f !== field && /^(input|textarea)$/.test(f.localName) &&
      !/^(checkbox|radio|password|hidden|submit|button|reset|file|image)$/i.test(f.type || ''))
    .map((f) => [f, String(f.value)]));
}`;

/**
 * Page-side reason `dom fill` cannot fill an element, or null when it can:
 * a disabled or read-only form control (naming the attribute or the disabled
 * `<fieldset>`), or for any other element the switch that keeps it from being
 * editable: `contenteditable="false"` (on it or the editor around it), an
 * `inert` ancestor, `aria-readonly` or `aria-disabled`; otherwise it is not a
 * fillable kind of element. Messages are {@link FILL_REFUSALS}.
 */
export const FILL_REFUSAL_JS = `(el) => {
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const refusals = ${JSON.stringify(FILL_REFUSALS)};
  const refuse = (kind, cause) => ({
    kind: kind,
    error: refusals[kind].message + (cause ? ' (' + cause + ')' : ''),
    suggestion: refusals[kind].suggestion
  });
  const tag = el.localName;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const disabled = (${DISABLED_CAUSE_JS})(el);
    if (disabled !== null) return refuse('disabled', disabled);
    return el.readOnly ? refuse('readOnly', 'readonly attribute') : null;
  }
  if (el.isContentEditable) return null;
  const host = el.closest('[contenteditable]');
  if (host && String(host.getAttribute('contenteditable')).trim().toLowerCase() === 'false') {
    return refuse('readOnly', 'contenteditable="false"' + (host === el ? '' : ' on ' + describe(host)));
  }
  if (el.closest('[inert]')) return refuse('inert', 'inside an inert element');
  if (el.getAttribute('aria-readonly') === 'true') return refuse('readOnly', 'aria-readonly="true"');
  if (el.getAttribute('aria-disabled') === 'true') return refuse('disabled', 'aria-disabled="true"');
  if (el.shadowRoot) {
    const fields = el.shadowRoot.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"])').length;
    return refuse('notFillable', '<' + tag + '> has ' + (fields === 0 ? 'no field' : fields + ' fields') + ' in its shadow root; select the one to fill, e.g. its [part~=…] or class');
  }
  return refuse('notFillable', '<' + tag + '> is not an input, textarea, select or contenteditable element');
}`;

/**
 * Page-side: the one text field, select or editable element in an element's
 * open shadow root (a web component such as `<sl-input>` wrapping a native
 * input), which `dom fill` fills in its place; null when the element is a
 * field itself or its shadow root has none or several.
 */
export const SHADOW_FIELD_JS = `(el) => {
  if (!el.shadowRoot || /^(input|textarea|select)$/.test(el.localName) || el.isContentEditable) return null;
  const fields = el.shadowRoot.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"])');
  return fields.length === 1 ? fields[0] : null;
}`;

/**
 * Page-side: fire a bubbling, non-cancelable event of a type on an element,
 * like `new Event(type, { bubbles: true })`. The event comes from
 * `document.createEvent`, which keeps working on pages that replace the
 * `Event` constructor (MooTools 1.2 does).
 */
export const FIRE_EVENT_JS = `(target, type) => {
  const event = target.ownerDocument.createEvent('Event');
  event.initEvent(type, true, false);
  return target.dispatchEvent(event);
}`;

/**
 * Page-side: fire `beforeinput` (cancelable) or `input` on a text field as
 * Chrome does when a user selects all and types the text: an `InputEvent`
 * with `inputType` `insertText` and the text as `data`, or
 * `deleteContentBackward` without data for an empty text (select all, then
 * Backspace). A multi-line text is one `insertText` with all of it as
 * `data` (no `insertLineBreak` per line, unlike typing it). Bubbling and
 * composed, from the field's own realm (its iframe's `InputEvent`); when
 * that cannot be built (a page whose `InputEvent` constructor throws, a
 * document without a window) a plain event gets `inputType` and `data` as
 * own properties, so listeners reading them still work. Evaluates to false
 * when a listener cancelled it.
 */
export const FIRE_INPUT_EVENT_JS = `(target, type, text) => {
  const cancelable = type === 'beforeinput';
  const init = {
    inputType: text === '' ? 'deleteContentBackward' : 'insertText',
    data: text === '' ? null : text,
    bubbles: true,
    cancelable: cancelable,
    composed: true
  };
  let event;
  try {
    event = new target.ownerDocument.defaultView.InputEvent(type, init);
  } catch (error) {
    event = target.ownerDocument.createEvent('Event');
    event.initEvent(type, true, cancelable);
    Object.defineProperty(event, 'inputType', { value: init.inputType });
    Object.defineProperty(event, 'data', { value: init.data });
  }
  return target.dispatchEvent(event);
}`;

/**
 * JavaScript function to fill an input element in a React-compatible way.
 *
 * This approach:
 * 1. Uses native property setters to bypass React's value tracking
 * 2. Dispatches input/change events that React listens for: for text
 *    fields (text-like inputs, textarea, contenteditable) the `beforeinput`
 *    and `input` `InputEvent`s Chrome fires for typing
 *    ({@link FIRE_INPUT_EVENT_JS}), for other fields a plain `input` event
 * 3. Properly handles focus/blur for form validation
 *
 * A page that cancels `beforeinput` (a rich editor rejecting the text) still
 * gets the value and the `input` event, so scripted flows keep working, and
 * the result warns that it was cancelled. A value the browser rejects (text
 * in a number field) is found by setting it and putting the old one back
 * before any event, so the page sees none; filling `""` into an empty text
 * field or editor fires none either.
 *
 * A `<label>` is filled through its control ({@link LABEL_CONTROL_JS}),
 * reported as e.g. `input (via label)`.
 *
 * The result is returned right away (a change handler may navigate). The
 * field and the value to expect are left in `window.__bdgFillCheck` for
 * {@link FILL_READ_BACK_SCRIPT}, which reads the value back a moment later.
 *
 * @remarks
 * Works with React, Vue, Angular, and vanilla JS applications.
 */
export const REACT_FILL_SCRIPT = `
(function(selector, parts, value, options) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector, parts);
  const fire = ${FIRE_EVENT_JS};
  const fireInput = ${FIRE_INPUT_EVENT_JS};
  const textTypes = ['text', 'email', 'search', 'url', 'tel', 'password', 'number'];
  const listOf = ${LIST_JS};
  const warnings = [];
  let expected = value;
  // Why a user could not reach the field (the value is still set, so scripted
  // flows keep working, but the result may not be what a user would see)
  const unreachableReason = (field) => {
    if (field.closest('[inert]')) return 'inert';
    const shown = (node) => !node.checkVisibility || node.checkVisibility();
    const modal = field.ownerDocument.querySelector('dialog:modal') ||
      Array.from(field.ownerDocument.querySelectorAll('[aria-modal="true"]')).find(shown);
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

  const labelControl = (${LABEL_CONTROL_JS})(el);
  if (el.localName === 'label' && !labelControl) {
    const quote = (text) => "'" + String(text).split("'").join("'\\\\''") + "'";
    const labelText = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    return {
      success: false,
      error: ${JSON.stringify(LABEL_WITHOUT_CONTROL.message)},
      elementType: 'label',
      unsuitableElement: true,
      suggestion: ${JSON.stringify(LABEL_WITHOUT_CONTROL.suggestion)}.split(${JSON.stringify(NAME_QUERY_PLACEHOLDER)}).join(quote('name=' + labelText))
    };
  }
  const viaLabel = labelControl ? ${JSON.stringify(VIA_LABEL_SUFFIX)} : '';
  if (labelControl) el = labelControl;
  const shadowField = (${SHADOW_FIELD_JS})(el);
  const viaShadow = shadowField ? ' in the shadow root of <' + el.localName + '>' : '';
  if (shadowField) el = shadowField;

  const tagName = el.tagName.toLowerCase();
  const inputType = el.type?.toLowerCase();

  const refusal = (${FILL_REFUSAL_JS})(el);
  if (refusal) {
    return {
      success: false,
      error: refusal.error,
      elementType: tagName + viaLabel + viaShadow,
      suggestion: refusal.suggestion,
      unsuitableElement: refusal.kind === 'notFillable'
    };
  }

  const unreachable = unreachableReason(el);
  if (unreachable) {
    warnings.push('The field is ' + unreachable + '; a user could not fill it (the value was set anyway)');
  }

  const fieldsBefore = (${FIELD_VALUES_JS})(el);
  el.focus();

  if (tagName === 'select' && el.multiple) {
    // Several options, separated by commas (an option whose value contains a
    // comma matches as a whole); "" selects none
    const options = listOf(el.options);
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
        elementType: tagName + viaLabel + viaShadow,
        suggestion: 'Available options: ' + options.slice(0, 10).map((o) => o.value || o.text.trim()).join(', ')
      };
    }
    options.forEach((o) => { o.selected = chosen.includes(o); });
    expected = chosen.map((o) => o.value).join(', ');
    fire(el, 'input');
    fire(el, 'change');
  } else if (tagName === 'select') {
    // Match by option value first, then by visible label
    const options = listOf(el.options);
    const option =
      options.find((o) => o.value === value) ||
      options.find((o) => o.text.trim() === value);
    if (!option) {
      return {
        success: false,
        error: 'Option not found: ' + value,
        exitCode: 81,
        elementType: tagName + viaLabel + viaShadow,
        suggestion: 'Available options: ' + options.slice(0, 10).map((o) => o.value || o.text.trim()).join(', ')
      };
    }
    el.value = option.value;
    expected = option.value;
    fire(el, 'input');
    fire(el, 'change');
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
        elementType: tagName + viaLabel + viaShadow,
        inputType: inputType,
        suggestion: 'Use true/false (also yes/no, on/off, 1/0)'
      };
    }
    const shouldCheck = truthy.includes(normalized);
    if (inputType === 'radio' && !shouldCheck) {
      return {
        success: false,
        error: 'A radio button cannot be unchecked',
        elementType: tagName + viaLabel + viaShadow,
        inputType: inputType,
        suggestion: 'Select another option in the same group instead'
      };
    }
    expected = shouldCheck ? 'checked' : 'unchecked';
    if (el.checked !== shouldCheck) {
      el.click();
    }
  } else if (inputType === 'file') {
    return {
      success: false,
      fileInput: true,
      elementType: tagName + viaLabel + viaShadow,
      inputType: inputType,
      error: 'File input'
    };
  } else if (el.isContentEditable) {
    if (value !== '' || el.textContent !== '') {
      if (!fireInput(el, 'beforeinput', value)) warnings.push(${JSON.stringify(FILL_BEFOREINPUT_CANCELLED_WARNING)});
      el.textContent = value;
      fireInput(el, 'input', value);
    }
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
        elementType: tagName + viaLabel + viaShadow,
        inputType: inputType || null,
        suggestion: 'Shorten the value (a user could not type more than maxlength characters)'
      };
    }
    
    const setValue = (text) => (setter ? setter.call(el, text) : (el.value = text));
    const typed = tagName === 'textarea' || textTypes.includes(inputType);
    const previous = el.value;
    setValue(value);
    const rejection = rejectedValue(el, inputType, value);
    setValue(previous);
    if (rejection) {
      if (options.blur !== false) el.blur();
      return {
        success: false,
        error: rejection.error,
        elementType: tagName + viaLabel + viaShadow,
        inputType: inputType,
        suggestion: rejection.suggestion
      };
    }

    if (value !== '' || previous !== '') {
      if (typed && !fireInput(el, 'beforeinput', value)) {
        warnings.push(${JSON.stringify(FILL_BEFOREINPUT_CANCELLED_WARNING)});
      }
      setValue(value);
      if (typed) fireInput(el, 'input', value);
      else fire(el, 'input');
      fire(el, 'change');
    }
    if (el.validity && (el.validity.rangeOverflow || el.validity.rangeUnderflow)) {
      warnings.push('The value is outside the allowed range (' + (el.min || 'no minimum') + ' to ' + (el.max || 'no maximum') + '); the form will not submit until it is fixed');
    }
  }
  
  if (options.blur !== false) {
    el.blur();
  }
  window.__bdgFillCheck = { el: el, expected: expected, before: fieldsBefore };

  return {
    success: true,
    selector: selector,
    value: el.isContentEditable
      ? el.textContent
      : inputType === 'password'
        ? '********'
        : tagName === 'select' && el.multiple
          ? listOf(el.selectedOptions).map((o) => o.value).join(', ')
          : el.value,
    element: (${ELEMENT_IDENTITY_JS})(el),
    elementType: tagName + viaLabel + viaShadow,
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
 * Page-side search for the field a moved value went to: one of the fields
 * recorded before the fill ({@link FIELD_VALUES_JS}) whose value changed to
 * the one given (trimmed, at least 2 characters). Evaluates to its id or
 * name (`input#first-name`, `input[name="first"]`) or else its
 * description, or undefined. Passwords are never searched for.
 */
export const MOVED_VALUE_JS = `(field, expected, before) => {
  const wanted = String(expected).trim();
  if (!before || wanted.length < 2 || (field.type || '').toLowerCase() === 'password') return undefined;
  const other = Array.from(before.keys()).find((f) =>
    String(f.value).trim() === wanted && String(before.get(f)).trim() !== wanted);
  if (!other) return undefined;
  if (other.id) return other.localName + '#' + other.id;
  return other.name ? other.localName + '[name="' + other.name + '"]' : (${ELEMENT_DESCRIPTION_JS})(other);
}`;

/**
 * Page script reading back the field the last fill left in
 * `window.__bdgFillCheck`, after one macrotask (so frameworks that render
 * asynchronously have updated it). The macrotask comes from a
 * `MessageChannel`, which fake timers and page code rarely replace. Evaluates
 * to the mismatch ({@link FILL_VALUE_MISMATCH_JS}), with `movedTo` when the
 * value turned up in another field ({@link MOVED_VALUE_JS}), or null when the
 * value matches, nothing was left (the page navigated) or the field left the
 * page.
 */
export const FILL_READ_BACK_SCRIPT = `(() => {
  const check = window.__bdgFillCheck;
  delete window.__bdgFillCheck;
  if (!check) return null;
  const readBack = () => {
    if (!check.el.isConnected) return null;
    const mismatch = (${FILL_VALUE_MISMATCH_JS})(check.el, check.expected);
    if (!mismatch) return null;
    const movedTo = (${MOVED_VALUE_JS})(check.el, check.expected, check.before);
    return movedTo ? Object.assign(mismatch, { movedTo: movedTo }) : mismatch;
  };
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve(readBack());
    };
    channel.port2.postMessage(null);
  });
})()`;

/**
 * JavaScript function to locate an element for clicking.
 *
 * Scrolls the element into view (reporting how far the page moved) and reports its center point and whether it
 * is the topmost element there (`hittable`). It does not click; see
 * `clickElement`, which dispatches real mouse events or falls back to
 * `el.click()`.
 *
 * @remarks
 * Handles both direct selector matching and indexed selection.
 * When index is provided, selects the nth matching element (0-based).
 * When selector matches multiple elements without index, prioritizes visible ones.
 * A `<label>` is clicked (and double-clicked) through its control when that
 * is visible ({@link LABEL_CONTROL_JS}), reported as e.g. `input (via label)`.
 * A hover first notes what is hidden around the element
 * ({@link REVEAL_SNAPSHOT_JS}), so its result can say what it revealed. For
 * a press, a probe (`window.__bdgPressProbe`) records whether the press
 * reaches the element, and otherwise which element it landed on: a browser
 * dialog or bubble can swallow input while the page looks normal. For a
 * click on a submit button, a probe on its form ({@link SUBMIT_PROBE_JS})
 * lets the result say when validation blocked the submit.
 * Slotted text hit-tests as its shadow host, so an element in a shadow root
 * that shows slotted content (a button labelled through a `<slot>`) is
 * topmost where its host is hit. An element that is not topmost because an
 * ancestor in the flat tree clips it away (a collapsed
 * `height: 0; overflow: hidden` accordion, {@link ANCESTOR_CLIP_JS}) is
 * reported as hidden by it, not as covered. A `display: contents` element
 * (a `<slot>`) has no box to aim at and gets DOM events.
 */
export const CLICK_ELEMENT_SCRIPT = `
(function(selector, parts, index, action) {
  if (window.__bdgPressProbe) {
    window.__bdgPressProbe.stop();
    delete window.__bdgPressProbe;
  }
  ${CLEAR_SUBMIT_PROBE_JS}
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
  
  const labelControl = action === 'click' || action === 'double' ? (${LABEL_CONTROL_JS})(el) : null;
  const viaLabel = labelControl &&
    (typeof labelControl.checkVisibility !== 'function' || labelControl.checkVisibility({ visibilityProperty: true, opacityProperty: true })) &&
    labelControl.getClientRects().length > 0
    ? ${JSON.stringify(VIA_LABEL_SUFFIX)}
    : '';
  if (viaLabel) el = labelControl;

  const tagName = el.tagName.toLowerCase();
  if (tagName === 'option') {
    const quote = (text) => "'" + String(text).split("'").join("'\\\\''") + "'";
    const select = el.closest('select');
    const target = select && select.id ? '#' + select.id : select && select.name ? 'select[name="' + select.name + '"]' : 'select';
    return {
      success: false,
      error: 'An <option> is chosen through its <select>, not clicked',
      selector: selector,
      elementType: tagName + viaLabel,
      exitCode: 81,
      suggestion: 'bdg dom fill ' + quote(target) + ' ' + quote(el.value || el.text.trim())
    };
  }
  // Disabled elements still get hover (tooltips often explain why)
  if (action !== 'hover' && (${DISABLED_CAUSE_JS})(el) !== null) {
    return {
      success: false,
      error: 'Element is disabled',
      selector: selector,
      elementType: tagName + viaLabel,
      suggestion: 'A user cannot click a disabled element; enable it first (it may depend on other fields)'
    };
  }
  let topView = el.ownerDocument.defaultView;
  while (topView.frameElement) topView = topView.parent;
  const scrollBefore = { x: topView.scrollX, y: topView.scrollY };
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  const scrolledBy = { x: Math.round(topView.scrollX - scrollBefore.x), y: Math.round(topView.scrollY - scrollBefore.y) };

  // The caller clicks with real mouse events at (x, y) when the element is the
  // topmost thing there; otherwise it falls back to el.click() via this handle.
  // Hit-testing happens in the element's own root (shadow root or frame
  // document), then in each enclosing document at the frame's position, so an
  // overlay over the iframe counts as covering it. The mouse events need
  // top-page coordinates: frame offsets (border and padding) are added.
  window.__bdgClickTarget = el;
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  const showsSlotted = (node) => Array.from(node.querySelectorAll('slot')).some((slot) => slot.assignedNodes().length > 0);
  const hitTest = (node, px, py) => {
    const root = node.getRootNode();
    const hit = (typeof root.elementFromPoint === 'function' ? root : node.ownerDocument).elementFromPoint(px, py);
    return hit !== null && (hit === node || node.contains(hit) || (hit === root.host && showsSlotted(node)));
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
  const tried = hasSize ? fractions : [[0.5, 0.5]];
  for (let i = 0; i < tried.length; i++) {
    const candidate = toTopPage(area.left + area.width * tried[i][0], area.top + area.height * tried[i][1]);
    point = point || candidate;
    if (hasSize && candidate.hittable) { point = candidate; break; }
  }
  const x = point.x;
  const y = point.y;
  const hittable = hasSize && point.hittable;
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const coveredBy = () => {
    const root = el.getRootNode();
    const hit = (typeof root.elementFromPoint === 'function' ? root : el.ownerDocument)
      .elementFromPoint(area.left + area.width / 2, area.top + area.height / 2);
    return hit && !el.contains(hit) ? ' (' + describe(hit) + ')' : '';
  };
  const style = view.getComputedStyle(el);
  let obstruction = null;
  if (style.display === 'contents') obstruction = ${JSON.stringify(NO_BOX_CLICK_REASON)};
  else if (style.display === 'none' || el.getClientRects().length === 0) obstruction = 'not rendered (display: none)';
  else if (style.visibility === 'hidden') obstruction = 'hidden (visibility: hidden)';
  else if (el.closest('[inert]')) obstruction = 'inert (the page made it non-interactive)';
  else if (style.pointerEvents === 'none') obstruction = 'not clickable (pointer-events: none)';
  else if (!hasSize) obstruction = 'zero-size';
  else if (!hittable) {
    const collapsed = (${ANCESTOR_CLIP_JS})(el, rect, describe).collapsed;
    obstruction = collapsed ? 'hidden (' + collapsed + ')' : 'covered by another element' + coveredBy();
  }

  if (action === 'hover') (${REVEAL_SNAPSHOT_JS})(el);
  const submitProbe = (action === 'click' || action === 'double') && (${SUBMIT_PROBE_JS})(el);

  if (hittable && action !== 'hover') {
    const probe = { reached: false, landedOn: null };
    const markReached = (event) => {
      const path = event.composedPath();
      let reached = false;
      for (let i = 0; i < path.length; i++) reached = reached || path[i] === el;
      if (reached) probe.reached = true;
      else if (!probe.landedOn && path[0] && path[0].nodeType === 1) probe.landedOn = describe(path[0]);
    };
    view.addEventListener('pointerdown', markReached, true);
    view.addEventListener('mousedown', markReached, true);
    probe.stop = () => {
      view.removeEventListener('pointerdown', markReached, true);
      view.removeEventListener('mousedown', markReached, true);
    };
    window.__bdgPressProbe = probe;
  }

  return {
    success: true,
    selector: selector,
    element: (${ELEMENT_IDENTITY_JS})(el),
    elementType: tagName + viaLabel,
    matchCount: allMatches.length,
    selectedIndex: typeof index === 'number' ? index : undefined,
    x: x,
    y: y,
    hittable: hittable,
    obstruction: obstruction,
    scrolledBy: scrolledBy.x !== 0 || scrolledBy.y !== 0 ? scrolledBy : undefined,
    submitProbe: submitProbe || undefined
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
