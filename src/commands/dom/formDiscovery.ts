/**
 * Form discovery script executed in page context.
 *
 * Discovers forms, extracts semantic labels, detects state and validation,
 * and returns structured data for agent consumption.
 */

import type { RawFormData } from '@/commands/dom/formTypes.js';

/**
 * Page-context script for form discovery.
 *
 * This script runs in the browser via Runtime.evaluate and discovers:
 * - Native form elements and inputs
 * - Custom components with ARIA roles
 * - Labels via priority chain (label[for], aria-label, placeholder, etc.)
 * - Current values and validation state
 * - Form relevance scoring for multi-form pages
 */
export const FORM_DISCOVERY_SCRIPT = `
(function() {
  const result = { forms: [] };

  function generateSelector(element) {
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }
    if (element.name) {
      const tag = element.tagName.toLowerCase();
      return tag + '[name="' + CSS.escape(element.name) + '"]';
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
      /Previous|Next|Back|Forward/gi,
      /^\\s*[<>]\\s*/,
      /\\s*[<>]\\s*$/,
    ];
    let cleaned = text;
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/\\s{2,}/g, ' ').trim();
    return cleaned || text.trim();
  }

  function extractLabel(element) {
    if (element.id) {
      const labelFor = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      if (labelFor) return cleanLabelText(labelFor.textContent);
    }
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return cleanLabelText(ariaLabel);
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
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

  function getSelectOptions(element) {
    if (element.tagName.toLowerCase() !== 'select') return undefined;
    return Array.from(element.options).map(opt => ({
      value: opt.value,
      label: opt.textContent.trim(),
      selected: opt.selected
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
    const parent = element.parentElement;
    if (parent) {
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
    const isInMain = formEl.closest('main, [role="main"], article, .main-content, #main');
    if (isInMain) score += 15;
    const isInHeader = formEl.closest('header, [role="banner"], nav, [role="navigation"]');
    if (isInHeader) score -= 10;
    const isInAside = formEl.closest('aside, [role="complementary"], footer, [role="contentinfo"]');
    if (isInAside) score -= 5;
    score += Math.min(fields.length * 3, 30);
    const hasSubmit = buttons.some(b => b.type === 'submit' || b.isPrimary);
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
    const hasSearchRole = formEl.closest('[role="search"]') || formEl.getAttribute('role') === 'search';
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
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }
    const headings = formEl.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
    for (const h of headings) {
      if (!h.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
        return h.textContent.trim();
      }
    }
    const legend = formEl.querySelector('legend');
    if (legend) return legend.textContent.trim();
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

  function discoverFields(container, formIndex, startIndex) {
    const fields = [];
    const nativeInputs = container.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
      'textarea, ' +
      'select'
    );
    const customInputs = container.querySelectorAll(
      '[role="textbox"], ' +
      '[role="checkbox"]:not(input), ' +
      '[role="radio"]:not(input), ' +
      '[role="combobox"], ' +
      '[role="listbox"], ' +
      '[role="switch"], ' +
      '[contenteditable="true"]'
    );
    const allInputs = new Set([...nativeInputs, ...customInputs]);
    let idx = startIndex;
    for (const el of allInputs) {
      const style = window.getComputedStyle(el);
      const isHidden = style.display === 'none' || style.visibility === 'hidden' || el.type === 'hidden';
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
        required: el.required || el.getAttribute('aria-required') === 'true',
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        readOnly: el.readOnly || false,
        hidden: isHidden,
        native: isNativeInput(el),
        value: value,
        checked: el.checked,
        validationMessage: el.validationMessage || undefined,
        isValid: el.checkValidity ? el.checkValidity() : true,
        ariaInvalid: el.getAttribute('aria-invalid') === 'true',
        hasErrorClass: el.classList.contains('error') || el.classList.contains('invalid'),
        siblingErrorText: findSiblingError(el),
        options: getSelectOptions(el)
      });
      idx++;
    }
    return fields;
  }

  function discoverButtons(container, startIndex) {
    const buttons = [];
    const buttonEls = container.querySelectorAll(
      'button, ' +
      'input[type="submit"], ' +
      'input[type="button"], ' +
      'input[type="reset"], ' +
      '[role="button"]'
    );
    let idx = startIndex;
    for (const el of buttonEls) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const type = el.type?.toLowerCase() || 'button';
      const btnType = type === 'submit' ? 'submit' : type === 'reset' ? 'reset' : 'button';
      const isPrimary = btnType === 'submit' ||
                        el.classList.contains('primary') ||
                        el.classList.contains('btn-primary') ||
                        el.classList.contains('submit');
      buttons.push({
        index: idx,
        selector: generateSelector(el),
        label: extractButtonLabel(el),
        type: btnType,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        isPrimary: isPrimary
      });
      idx++;
    }
    return buttons;
  }

  const forms = document.querySelectorAll('form');
  let globalIndex = 0;

  if (forms.length === 0) {
    const bodyFields = discoverFields(document.body, 0, 0);
    const bodyButtons = discoverButtons(document.body, bodyFields.length);
    if (bodyFields.length > 0) {
      result.forms.push({
        index: 0,
        name: document.title || 'Page',
        action: null,
        method: 'GET',
        step: null,
        relevanceScore: bodyFields.length * 3,
        inIframe: false,
        fields: bodyFields,
        buttons: bodyButtons
      });
    }
  } else {
    for (let i = 0; i < forms.length; i++) {
      const formEl = forms[i];
      const fields = discoverFields(formEl, i, globalIndex);
      globalIndex += fields.length;
      const buttons = discoverButtons(formEl, globalIndex);
      globalIndex += buttons.length;
      const inIframe = formEl.ownerDocument !== document;
      result.forms.push({
        index: i,
        name: extractFormName(formEl),
        action: formEl.action || null,
        method: (formEl.method || 'GET').toUpperCase(),
        step: detectFormStep(formEl),
        relevanceScore: calculateRelevance(formEl, fields, buttons),
        inIframe: inIframe,
        fields: fields,
        buttons: buttons
      });
    }
  }

  result.forms.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return result;
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
