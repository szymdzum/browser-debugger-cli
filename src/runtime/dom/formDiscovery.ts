/**
 * Form discovery script executed in page context.
 *
 * Discovers forms, extracts semantic labels, detects state and validation,
 * and returns structured data for agent consumption.
 */

import { MASKED_VALUE, SENSITIVE_FIELD_JS } from '@/runtime/dom/elementInfo.js';
import type { RawFormData } from '@/runtime/dom/formTypes.js';
import { DEEP_QUERY_JS } from '@/runtime/dom/targetNode.js';

/** Custom elements checked for a closed shadow root holding fields (bounds the CDP calls) */
const CLOSED_HOST_LIMIT = 50;

/**
 * Page-side order of elements in the composed tree, across open shadow
 * roots: an element's shadow content comes right after it. Takes two
 * elements, returns a negative number when the first comes first.
 */
export const COMPOSED_ORDER_JS = `(a, b) => {
  const chain = (el) => {
    const hosts = [el];
    for (let host = el.getRootNode().host; host; host = host.getRootNode().host) hosts.unshift(host);
    return hosts;
  };
  const first = chain(a);
  const second = chain(b);
  for (let i = 0; i < first.length && i < second.length; i++) {
    if (first[i] === second[i]) continue;
    return first[i].compareDocumentPosition(second[i]) & 4 ? -1 : 1;
  }
  return first.length - second.length;
}`;

/**
 * Page-side `closest()` across open shadow roots: the closest ancestor (or
 * the element itself) matching a selector in the element's tree, else in
 * its host's tree, and so on up. Takes the element and the selector.
 */
export const COMPOSED_CLOSEST_JS = `(el, selector) => {
  for (let node = el; node; node = node.getRootNode().host) {
    const match = node.closest(selector);
    if (match) return match;
  }
  return null;
}`;

/**
 * Page-context script for form discovery.
 *
 * This script runs in the browser via Runtime.evaluate and discovers:
 * - Native form elements and inputs
 * - Custom components with ARIA roles
 * - Labels via priority chain (label[for], aria-label, placeholder, etc.)
 * - Current values and validation state (never a secret: a hidden input's
 *   value is left out, a sensitive text field's or select's
 *   ({@link SENSITIVE_FIELD_JS}; checkboxes and radios named like one keep
 *   their checked state) is {@link MASKED_VALUE} when filled, and a
 *   sensitive select's options do not say which is chosen)
 * - Form relevance scoring for multi-form pages
 *
 * Forms and fields in open shadow roots are found too (nested ones
 * included, through {@link DEEP_QUERY_JS}; same-origin iframes are left to
 * the iframe hint): a field belongs to the closest form around it across
 * shadow roots ({@link COMPOSED_CLOSEST_JS}), so a component's input in a
 * light DOM form is that form's, and labels are looked up in the field's
 * own root. A form in a shadow root carries its host (`shadowHost`).
 *
 * Evaluates to `{ data, nodes, hosts }`: the discovery result (read by
 * value), the listed fields and buttons by index (so the daemon can bind
 * indices to the exact nodes), and custom elements without an open shadow
 * root (checked by the daemon for a closed one holding fields).
 */
export const FORM_DISCOVERY_SCRIPT = `
(function() {
  const result = { forms: [] };
  const nodes = [];
  const deepQuery = ${DEEP_QUERY_JS};
  const composedOrder = ${COMPOSED_ORDER_JS};
  const composedClosest = ${COMPOSED_CLOSEST_JS};

  // Elements of the main document and its open shadow roots matching a
  // selector, in composed tree order
  function deepAll(selector) {
    return deepQuery(selector, null).filter((el) => el.ownerDocument === document).sort(composedOrder);
  }

  // Everything a selector search reaches: the document, its open shadow
  // roots and same-origin iframes (a selector is unique when it matches once
  // in all of them)
  const allElements = deepQuery('*', null);
  const searchRoots = [document];
  for (const el of allElements) {
    if (el.shadowRoot) searchRoots.push(el.shadowRoot);
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      let frameDocument = null;
      try { frameDocument = el.contentDocument; } catch (e) { frameDocument = null; }
      if (frameDocument) searchRoots.push(frameDocument);
    }
  }

  // Short name of the shadow host an element is in, e.g. x-login#main
  function shadowHostOf(element) {
    const host = element.getRootNode().host;
    return host ? host.localName + (host.id ? '#' + host.id : '') : undefined;
  }

  // Rendered and not visibility-hidden, ancestors included (opacity is left
  // out: styled checkboxes and radios are often transparent)
  function isShown(element) {
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ visibilityProperty: true });
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  // Inside an open dialog: <dialog open>, aria-modal or a dialog role, or a
  // modal without them (DocSearch): an overlay ancestor below <body>
  // (position fixed or absolute) that is raised (z-index > 0) or has a
  // backdrop and whose class names a modal or dialog, or a fixed overlay over
  // half the viewport or more that is raised or lies over other page content
  // at the viewport centre. Static wrappers (Drupal's
  // dialog-off-canvas-main-canvas) and fixed app shells holding the whole
  // page are not dialogs.
  function inDialog(element) {
    if (composedClosest(element, 'dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]')) return true;
    const viewportArea = window.innerWidth * window.innerHeight;
    const parentOf = (node) => node.parentElement || node.getRootNode().host || null;
    for (let node = parentOf(element); node && node !== document.body; node = parentOf(node)) {
      const style = window.getComputedStyle(node);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      const raised = parseInt(style.zIndex, 10) > 0;
      const className = typeof node.className === 'string' ? node.className : '';
      if (/(^|[\\s_-])(modal|dialog)($|[\\s_-])/i.test(className) && (raised || hasBackdrop(node))) return true;
      if (style.position !== 'fixed') continue;
      const box = node.getBoundingClientRect();
      if (box.width * box.height >= viewportArea / 2 && (raised || coversContent(node))) return true;
    }
    return false;
  }

  // A backdrop element next to or inside an overlay
  function hasBackdrop(node) {
    const backdrop = /backdrop|overlay/i;
    const near = [node.previousElementSibling, node.nextElementSibling, ...Array.from(node.children)];
    return near.some((n) => n && typeof n.className === 'string' && backdrop.test(n.className));
  }

  // The overlay is on top at the viewport centre with other page content
  // (not its ancestors) below it
  function coversContent(node) {
    const stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (!stack.length || !node.contains(stack[0])) return false;
    return stack.some((n) => !n.contains(node) && !node.contains(n));
  }

  function isUnique(selector) {
    try {
      let count = 0;
      for (const root of searchRoots) {
        count += root.querySelectorAll(selector).length;
        if (count > 1) return false;
      }
      return count === 1;
    } catch (e) {
      return false;
    }
  }

  function generateSelector(element) {
    if (element.id && isUnique('#' + CSS.escape(element.id))) {
      return '#' + CSS.escape(element.id);
    }
    if (element.name) {
      const byName = element.tagName.toLowerCase() + '[name="' + CSS.escape(element.name) + '"]';
      if (isUnique(byName)) return byName;
      const byValue = byName + '[value="' + CSS.escape(element.getAttribute('value') || '') + '"]';
      if (element.hasAttribute('value') && isUnique(byValue)) return byValue;
    }
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
    if (siblings.length === 1) {
      const parentSelector = generateSelector(parent);
      return parentSelector + ' > ' + tag;
    }
    const index = siblings.indexOf(element);
    const parentSelector = generateSelector(parent);
    return parentSelector + ' > ' + tag + ':nth-of-type(' + (index + 1) + ')';
  }

  function cleanLabelText(text) {
    if (!text) return text;
    const patterns = [
      /Previous\\s*arrow/gi,
      /Next\\s*arrow/gi,
      /\\barrow\\b/gi,
      /\\bchevron\\b/gi,
      /←|→|↑|↓|▲|▼|◀|▶/g,
      /\\u25C0|\\u25B6|\\u25B2|\\u25BC/g,
      /^\\s*[<>]\\s*/,
      /\\s*[<>]\\s*$/,
    ];
    let cleaned = text;
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/\\s{2,}/g, ' ').trim();
    cleaned = cleaned.replace(/^\\*\\s+/, '').replace(/\\s+\\*(\\s*:?)$/, '$1');
    return cleaned || text.trim();
  }

  // The element labelling a field, in the field's own tree (document or
  // shadow root): label[for], aria-labelledby, wrapping label
  function labelElement(element) {
    const root = element.getRootNode();
    const labelFor = element.id ? root.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null;
    const labelledBy = element.getAttribute('aria-labelledby');
    return labelFor || (labelledBy && root.getElementById(labelledBy)) || element.closest('label');
  }

  // A standalone required star in label text: "* Name", "Name *", "Name *:"
  // (not a footnote mark such as "Terms*")
  function labelMarksRequired(text) {
    return /^\\*\\s|\\s\\*\\s*:?$/.test(String(text).trim());
  }

  // Required by attribute, ARIA, or a label marked with a standalone star,
  // or with an element of its own holding just "*" (<span aria-hidden>*</span>)
  function isRequired(element) {
    if (element.required || element.getAttribute('aria-required') === 'true') return true;
    const label = labelElement(element);
    if (!label) return false;
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach(i => i.remove());
    return labelMarksRequired(clone.textContent || '') ||
      Array.from(clone.querySelectorAll('*')).some(n => n.textContent.trim() === '*');
  }

  // Name of the radio or checkbox group a field belongs to: its radiogroup's
  // label, its fieldset's legend, or its name
  function groupLabel(element) {
    const type = element.type?.toLowerCase();
    if ((type !== 'radio' && type !== 'checkbox') || !element.name) return undefined;
    const group = element.closest('[role="radiogroup"], fieldset');
    const named = group && (group.getAttribute('aria-label') ||
      (group.querySelector(':scope > legend') || {}).textContent);
    if (named && named.trim()) return cleanLabelText(named);
    return element.name
      .replace(/[_-]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, s => s.toUpperCase());
  }

  function extractLabel(element) {
    const root = element.getRootNode();
    if (element.id) {
      const labelFor = root.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      if (labelFor) return cleanLabelText(labelFor.textContent);
    }
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return cleanLabelText(ariaLabel);
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = root.getElementById(ariaLabelledBy);
      if (labelEl) return cleanLabelText(labelEl.textContent);
    }
    const wrappingLabel = element.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      const inputs = clone.querySelectorAll('input, select, textarea, button');
      inputs.forEach(i => i.remove());
      const text = clone.textContent.trim();
      if (text) return cleanLabelText(text);
    }
    if (element.placeholder) return cleanLabelText(element.placeholder);
    const title = element.getAttribute('title');
    if (title) return cleanLabelText(title);
    if (element.name) {
      return element.name
        .replace(/[_-]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, s => s.toUpperCase());
    }
    return 'Unlabeled field';
  }

  function extractButtonLabel(element) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (element.value && element.type !== 'submit') return element.value;
    const text = element.textContent.trim();
    if (text) return text;
    if (element.value) return element.value;
    const title = element.getAttribute('title');
    if (title) return title;
    return 'Button';
  }

  function getFieldValue(element) {
    const tag = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase() || 'text';
    if (type === 'hidden') return '';
    if (isSecret(element)) {
      return (element.isContentEditable ? element.textContent : element.value) ? '${MASKED_VALUE}' : '';
    }
    if (tag === 'select') {
      if (element.multiple) {
        return Array.from(element.selectedOptions).map(o => o.value);
      }
      return element.value;
    }
    if (type === 'checkbox' || type === 'radio') {
      return element.checked;
    }
    if (element.getAttribute('role') === 'checkbox' || element.getAttribute('role') === 'switch') {
      return element.getAttribute('aria-checked') === 'true';
    }
    if (element.isContentEditable) {
      return element.textContent || '';
    }
    return element.value || '';
  }

  function getFieldState(element, value) {
    const type = element.type?.toLowerCase() || 'text';
    if (type === 'checkbox' || element.getAttribute('role') === 'checkbox' || element.getAttribute('role') === 'switch') {
      return value ? 'checked' : 'unchecked';
    }
    if (type === 'radio') {
      return value ? 'checked' : 'unchecked';
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? 'filled' : 'empty';
    }
    if (typeof value === 'string') {
      return value.length > 0 ? 'filled' : 'empty';
    }
    return 'empty';
  }

  function getFieldType(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    if (role === 'textbox') return 'textbox';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (role === 'combobox') return 'combobox';
    if (role === 'listbox') return 'listbox';
    if (role === 'switch') return 'switch';
    if (element.isContentEditable) return 'contenteditable';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (tag === 'input') {
      const type = element.type?.toLowerCase() || 'text';
      return type;
    }
    return 'unknown';
  }

  function isNativeInput(element) {
    const tag = element.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function isSecret(element) {
    const type = element.type?.toLowerCase() || 'text';
    if (type === 'checkbox' || type === 'radio') return false;
    if (element.getAttribute('role') === 'checkbox' || element.getAttribute('role') === 'switch') return false;
    return (${SENSITIVE_FIELD_JS})(element);
  }

  function getSelectOptions(element) {
    if (element.tagName.toLowerCase() !== 'select') return undefined;
    const secret = isSecret(element);
    return Array.from(element.options).map(opt => ({
      value: secret ? '' : opt.value,
      label: opt.textContent.trim(),
      selected: secret ? false : opt.selected
    }));
  }

  function findSiblingError(element) {
    const next = element.nextElementSibling;
    if (next) {
      const isError = next.classList.contains('error') ||
                      next.classList.contains('invalid') ||
                      next.classList.contains('field-error') ||
                      next.classList.contains('error-message') ||
                      next.getAttribute('role') === 'alert';
      if (isError) return next.textContent.trim();
    }
    // aria-errormessage always names the error; aria-describedby does when the
    // field is marked invalid or the description looks like an error
    const invalid = element.getAttribute('aria-invalid') === 'true';
    const errorIds = (element.getAttribute('aria-errormessage') || '').split(/\\s+/).filter(Boolean);
    const describedIds = (element.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
    for (const id of [...errorIds, ...describedIds]) {
      const target = element.getRootNode().getElementById(id);
      const looksLikeError = errorIds.includes(id) || invalid ||
        /error|invalid|alert/i.test(target ? target.className + ' ' + (target.getAttribute('role') || '') : '');
      if (target && looksLikeError && target.textContent.trim()) {
        return target.textContent.trim();
      }
    }
    const parent = element.parentElement;
    const controls = parent ? parent.querySelectorAll('input, select, textarea, [contenteditable="true"]') : [];
    if (parent && controls.length === 1) {
      const errorEl = parent.querySelector('.error-message, .field-error, [role="alert"]');
      if (errorEl && errorEl !== element) return errorEl.textContent.trim();
    }
    return undefined;
  }

  function calculateRelevance(formEl, fields, buttons) {
    let score = 0;
    const rect = formEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (centerX > viewportWidth * 0.2 && centerX < viewportWidth * 0.8) score += 10;
    if (centerY > 0 && centerY < viewportHeight) score += 5;
    const isInMain = composedClosest(formEl, 'main, [role="main"], article, .main-content, #main');
    if (isInMain) score += 15;
    const isInHeader = composedClosest(formEl, 'header, [role="banner"], nav, [role="navigation"]');
    if (isInHeader) score -= 10;
    const isInAside = composedClosest(formEl, 'aside, [role="complementary"], footer, [role="contentinfo"]');
    if (isInAside) score -= 5;
    const distinctFields = new Set(
      fields.map((f) => (f.type === 'radio' || f.type === 'checkbox') && f.name ? f.type + ':' + f.name : f.index)
    ).size;
    score += Math.min(distinctFields * 3, 30);
    const textTypes = ['text', 'search', 'email', 'password', 'textarea', 'tel', 'url', 'number', 'textbox'];
    if (fields.some((f) => textTypes.includes(f.type))) score += 10;
    const hasSubmit = buttons.some(b => b.type === 'submit' || b.primaryClass);
    if (hasSubmit) score += 10;
    const style = window.getComputedStyle(formEl);
    if (style.display === 'none' || style.visibility === 'hidden') score -= 100;
    return score;
  }

  function detectFormStep(formEl) {
    const stepIndicators = formEl.querySelectorAll('[aria-current="step"], .step.active, .wizard-step.current');
    if (stepIndicators.length === 0) {
      const pageSteps = document.querySelectorAll('.step, .wizard-step, [role="tablist"] [role="tab"]');
      if (pageSteps.length > 1) {
        const activeIndex = Array.from(pageSteps).findIndex(s =>
          s.classList.contains('active') ||
          s.classList.contains('current') ||
          s.getAttribute('aria-selected') === 'true'
        );
        if (activeIndex >= 0) {
          return { current: activeIndex + 1, total: pageSteps.length };
        }
      }
    }
    const ariaStep = formEl.querySelector('[aria-current="step"]');
    if (ariaStep) {
      const allSteps = formEl.querySelectorAll('[role="listitem"], .step');
      const currentIdx = Array.from(allSteps).indexOf(ariaStep);
      if (currentIdx >= 0) {
        return { current: currentIdx + 1, total: allSteps.length };
      }
    }
    return null;
  }

  function findNearbyHeading(formEl) {
    let sibling = formEl.previousElementSibling;
    let distance = 0;
    while (sibling && distance < 3) {
      if (sibling.matches('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
        return sibling.textContent.trim();
      }
      const heading = sibling.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (heading) return heading.textContent.trim();
      sibling = sibling.previousElementSibling;
      distance++;
    }
    const parent = formEl.parentElement;
    if (parent) {
      const heading = parent.querySelector(':scope > h1, :scope > h2, :scope > h3');
      if (heading && heading.compareDocumentPosition(formEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return heading.textContent.trim();
      }
    }
    return null;
  }

  function matchesWord(text, word) {
    const pattern = new RegExp('\\\\b' + word + '\\\\b', 'i');
    return pattern.test(text);
  }

  function inferFormType(formEl) {
    const inputs = formEl.querySelectorAll('input, textarea, select');
    const types = Array.from(inputs).map(i => i.type?.toLowerCase() || i.tagName.toLowerCase());
    const names = Array.from(inputs).map(i => (i.name || '').toLowerCase());
    const allText = (Array.from(inputs).map(i => i.name + ' ' + i.placeholder + ' ' + i.id).join(' ')).toLowerCase();
    if (types.includes('password')) {
      if (types.filter(t => t === 'password').length >= 2) return 'Change Password';
      if (matchesWord(allText, 'register') || matchesWord(allText, 'signup') || matchesWord(allText, 'create')) return 'Registration';
      return 'Login';
    }
    const hasSearchRole = composedClosest(formEl, '[role="search"]');
    const hasSearchInput = formEl.querySelector('[type="search"], [aria-label*="search" i]');
    if (hasSearchRole || hasSearchInput) return 'Search';
    const interactiveTypes = types.filter(t => !['hidden', 'submit', 'button', 'reset', 'image'].includes(t));
    if (interactiveTypes.length <= 2 && matchesWord(allText, 'search')) return 'Search';
    if (matchesWord(allText, 'address') || matchesWord(allText, 'street') || matchesWord(allText, 'postcode') ||
        matchesWord(allText, 'zipcode') || matchesWord(allText, 'city') || matchesWord(allText, 'county')) {
      return 'Address';
    }
    if (matchesWord(allText, 'email') && (matchesWord(allText, 'message') || matchesWord(allText, 'subject'))) {
      return 'Contact';
    }
    if (matchesWord(allText, 'card') || matchesWord(allText, 'cvv') || matchesWord(allText, 'expiry')) {
      return 'Payment';
    }
    if (names.some(n => matchesWord(n, 'subscribe') || matchesWord(n, 'newsletter'))) {
      return 'Newsletter';
    }
    return null;
  }

  function extractFormName(formEl) {
    const ariaLabel = formEl.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    const ariaLabelledBy = formEl.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = formEl.getRootNode().getElementById(ariaLabelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }
    const headings = formEl.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
    for (const h of headings) {
      if (!h.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
        return h.textContent.trim();
      }
    }
    const title = formEl.getAttribute('title');
    if (title) return title;
    const name = formEl.getAttribute('name');
    if (name) {
      return name
        .replace(/[_-]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, s => s.toUpperCase());
    }
    const nearbyHeading = findNearbyHeading(formEl);
    if (nearbyHeading) return nearbyHeading;
    const inferredType = inferFormType(formEl);
    if (inferredType) return inferredType;
    return null;
  }

  // Fields of the page (native controls first, then ARIA ones) and the form
  // each belongs to
  const nativeInputs = deepAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
    'textarea, ' +
    'select'
  );
  const customInputs = deepAll(
    '[role="textbox"], ' +
    '[role="checkbox"]:not(input), ' +
    '[role="radio"]:not(input), ' +
    '[role="combobox"], ' +
    '[role="listbox"], ' +
    '[role="switch"], ' +
    '[contenteditable="true"]'
  );
  const allInputs = Array.from(new Set([...nativeInputs, ...customInputs]));
  const allButtons = deepAll(
    'button, ' +
    'input[type="submit"], ' +
    'input[type="button"], ' +
    'input[type="reset"], ' +
    '[role="button"]'
  );
  const ownerForm = (el) => composedClosest(el, 'form');

  function discoverFields(inputs, formIndex, startIndex) {
    const fields = [];
    let idx = startIndex;
    for (const el of inputs) {
      nodes[idx] = el;
      const isHidden = el.type === 'hidden' || !isShown(el);
      const value = getFieldValue(el);
      fields.push({
        index: idx,
        formIndex: formIndex,
        selector: generateSelector(el),
        type: getFieldType(el),
        inputType: el.type?.toLowerCase(),
        label: extractLabel(el),
        name: el.name || null,
        placeholder: el.placeholder || undefined,
        required: isRequired(el),
        groupLabel: groupLabel(el),
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        readOnly: el.readOnly || false,
        hidden: isHidden,
        native: isNativeInput(el),
        value: value,
        checked: el.checked,
        validationMessage: el.validationMessage || undefined,
        isValid: el.validity ? el.validity.valid : true,
        valueMissing: el.validity ? el.validity.valueMissing : false,
        ariaInvalid: el.getAttribute('aria-invalid') === 'true',
        hasErrorClass: el.classList.contains('error') || el.classList.contains('invalid'),
        siblingErrorText: findSiblingError(el),
        options: getSelectOptions(el)
      });
      idx++;
    }
    return fields;
  }

  function discoverButtons(buttonEls, startIndex) {
    const buttons = [];
    let idx = startIndex;
    for (const el of buttonEls) {
      if (!isShown(el)) continue;
      nodes[idx] = el;
      const type = el.type?.toLowerCase() || 'button';
      const btnType = type === 'submit' ? 'submit' : type === 'reset' ? 'reset' : 'button';
      const explicitSubmit = btnType === 'submit' &&
        (el.tagName === 'INPUT' || (el.getAttribute('type') || '').toLowerCase() === 'submit');
      const formDefault = btnType === 'submit' && !explicitSubmit && Boolean(el.form);
      const primaryClass = Array.from(el.classList).some(c => /^(btn[-_])?(primary|submit)$/i.test(c));
      buttons.push({
        index: idx,
        selector: generateSelector(el),
        label: extractButtonLabel(el),
        type: btnType,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        explicitSubmit: explicitSubmit,
        formDefault: formDefault,
        primaryClass: primaryClass
      });
      idx++;
    }
    return buttons;
  }

  const forms = deepAll('form');
  let globalIndex = 0;

  if (forms.length === 0) {
    const bodyFields = discoverFields(allInputs, 0, 0);
    const bodyButtons = discoverButtons(allButtons, bodyFields.length);
    // One shadow host holding all the fields marks the group
    const groupHosts = new Set(allInputs.map(shadowHostOf));
    const groupHost = groupHosts.size === 1 ? Array.from(groupHosts)[0] : undefined;
    if (bodyFields.length > 0) {
      result.forms.push({
        index: 0,
        name: document.title || 'Page',
        action: null,
        method: 'GET',
        step: null,
        relevanceScore: bodyFields.length * 3,
        hidden: false,
        inDialog: false,
        inIframe: false,
        shadowHost: groupHost,
        fields: bodyFields,
        buttons: bodyButtons
      });
    }
  } else {
    for (let i = 0; i < forms.length; i++) {
      const formEl = forms[i];
      const fields = discoverFields(allInputs.filter((el) => ownerForm(el) === formEl), i, globalIndex);
      globalIndex += fields.length;
      const buttons = discoverButtons(allButtons.filter((el) => ownerForm(el) === formEl), globalIndex);
      globalIndex += buttons.length;
      const inIframe = formEl.ownerDocument !== document;
      // Shown when a field or a button is (buttons list shown ones only), or
      // it has neither (a form with only type=hidden inputs and no button)
      const shown = isShown(formEl) &&
        (fields.some((f) => !f.hidden) || buttons.length > 0 || fields.length === 0);
      result.forms.push({
        index: i,
        name: extractFormName(formEl),
        action: formEl.action || null,
        method: (formEl.method || 'GET').toUpperCase(),
        step: detectFormStep(formEl),
        relevanceScore: calculateRelevance(formEl, fields, buttons),
        hidden: !shown,
        inDialog: shown && inDialog(formEl),
        inIframe: inIframe,
        shadowHost: shadowHostOf(formEl),
        fields: fields,
        buttons: buttons
      });
    }
  }

  // Forms the main document does not contain may be in its same-origin iframes
  if (result.forms.length === 0) {
    result.frameForms = [];
    for (const frame of document.querySelectorAll('iframe, frame')) {
      let frameDocument = null;
      try { frameDocument = frame.contentDocument; } catch (e) { frameDocument = null; }
      if (frameDocument && frameDocument.querySelector('form, input:not([type=hidden]), select, textarea')) {
        result.frameForms.push({ url: frame.src || 'about:blank' });
      }
    }
  }

  result.readyState = document.readyState;
  const hosts = allElements.filter((el) =>
    el.ownerDocument === document && el.localName.includes('-') && !el.shadowRoot && el.matches(':defined')
  ).slice(0, ${CLOSED_HOST_LIMIT});
  return { data: result, nodes: nodes, hosts: hosts };
})()
`;

/**
 * Type guard for raw form data.
 *
 * @param value - Unknown value to check
 * @returns True if value matches RawFormData structure
 */
export function isRawFormData(value: unknown): value is RawFormData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj['forms']);
}
