/**
 * Chrome Issues messages: the one-line reason of each issue kind bdg keeps,
 * and the notes of the `bdg console` Issues block, `peek` and `dom form`.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { MAX_PAGE_ISSUES } from '@/constants.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

type GenericIssueErrorType = Protocol.Audits.GenericIssueErrorType;
type ElementAccessibilityIssueReason = Protocol.Audits.ElementAccessibilityIssueReason;

/** Reasons of the form errors bdg keeps (Chrome's other generic issues are dropped) */
export const FORM_ERROR_TEXTS: Partial<Record<GenericIssueErrorType, string>> = {
  FormLabelForNameError:
    "A label's for attribute names a field's name, not its id: the label is not linked",
  FormDuplicateIdForInputError:
    'Duplicate id on form fields: labels and autofill reach only the first',
  FormInputWithNoLabelError: 'Form field has no label',
  FormEmptyIdAndNameAttributesForInputError:
    'Form field has neither id nor name: autofill and form data cannot identify it',
  FormAriaLabelledByToNonExistingIdError: 'aria-labelledby points at an id that does not exist',
  FormLabelHasNeitherForNorNestedInputError:
    'Label has no for attribute and no field inside: it labels nothing',
  FormLabelForMatchesNonExistingIdError:
    "Label's for attribute matches no element id: it labels nothing",
};

/** Reasons of the element content-model errors */
const ELEMENT_A11Y_TEXTS: Record<ElementAccessibilityIssueReason, string> = {
  DisallowedSelectChild: '<select> holds an element it does not allow',
  DisallowedOptGroupChild: '<optgroup> holds an element it does not allow',
  NonPhrasingContentOptionChild: '<option> holds non-phrasing content',
  InteractiveContentOptionChild: '<option> holds interactive content',
  InteractiveContentLegendChild: '<legend> holds interactive content',
  InteractiveContentSummaryDescendant:
    'Interactive element inside <summary>: keyboard and screen reader users cannot reach it',
};

/**
 * Reason of a document in quirks mode.
 *
 * @param limited - Limited-quirks mode (a legacy doctype) rather than quirks mode (none)
 * @returns Reason
 */
export function quirksModeIssueText(limited: boolean): string {
  return limited
    ? 'Page is in limited-quirks mode (legacy doctype): some layout differs from standards mode'
    : 'Page is in quirks mode (no <!doctype html>): layout differs from standards mode';
}

/**
 * Reason of a stylesheet that was not loaded.
 *
 * @param reason - Chrome's reason
 * @param failed - The failed request, if that was the reason
 * @returns Reason
 */
export function stylesheetIssueText(
  reason: Protocol.Audits.StyleSheetLoadingIssueReason,
  failed?: Protocol.Audits.FailedRequestInfo
): string {
  if (reason === 'LateImportRule') return '@import after other rules is ignored';
  const why = failed?.failureMessage ? ` (${failed.failureMessage})` : '';
  return `Stylesheet failed to load: ${failed?.url ?? 'unknown URL'}${why}`;
}

/**
 * Reason of a Content Security Policy violation Chrome does not log.
 *
 * @param type - Violation type
 * @param directive - Directive violated
 * @param reportOnly - Only reported, not enforced
 * @returns Reason
 */
export function cspIssueText(
  type: Protocol.Audits.ContentSecurityPolicyViolationType,
  directive: string,
  reportOnly: boolean
): string {
  const what =
    type === 'kEvalViolation'
      ? 'eval() or new Function()'
      : type === 'kTrustedTypesPolicyViolation'
        ? 'creating a Trusted Types policy'
        : 'a string assigned to a DOM sink (Trusted Types)';
  return `CSP ${reportOnly ? 'reported (report-only)' : 'blocked'} ${what}: ${directive}`;
}

/**
 * Reason of an element whose content breaks its content model.
 *
 * @param reason - Chrome's reason
 * @param disallowedAttributes - The content has attributes it may not have
 * @returns Reason
 */
export function elementAccessibilityIssueText(
  reason: ElementAccessibilityIssueReason,
  disallowedAttributes: boolean
): string {
  return `${ELEMENT_A11Y_TEXTS[reason]}${disallowedAttributes ? ' (with disallowed attributes)' : ''}`;
}

/**
 * Reason of a cookie that `document.cookie` could not set.
 *
 * @param name - Cookie name
 * @param reasons - Chrome's exclusion reasons
 * @returns Reason
 */
export function cookieIssueText(name: string, reasons: string[]): string {
  return `Cookie "${name}" set by document.cookie was rejected: ${reasons.join(', ')}`;
}

/**
 * Note under the Issues block when it lists only some of them.
 *
 * @param more - Issues not listed
 * @param dropped - Issues of the page not kept at the per-page limit
 * @returns e.g. `(+3 more; bdg console --json lists them)`
 */
export function moreIssuesNote(more: number, dropped: number): string {
  const parts = [
    more > 0 && `+${more} more; ${sessionCommand('bdg console --json')} lists them`,
    dropped > 0 && `${dropped} more not kept: bdg keeps the first ${MAX_PAGE_ISSUES} per page`,
  ].filter(Boolean);
  return `(${parts.join('; ')})`;
}

/**
 * The count line of `bdg peek`.
 *
 * @param count - Issues of the page currently loaded
 * @returns e.g. `ISSUES: 2 (bdg console lists them)`
 */
export function peekIssuesLine(count: number): string {
  return `ISSUES: ${count} (${sessionCommand('bdg console')} lists them)`;
}

/**
 * A form markup error under the row of its field in `dom form`.
 *
 * @param text - Chrome's reason
 * @returns e.g. `      ⚠ Duplicate id on form fields: ...`
 */
export function fieldIssueLine(text: string): string {
  return `      ⚠ ${text}`;
}

/** Heading of the `dom form` list of form issues not tied to a listed field */
export const PAGE_FORM_ISSUES_HEADING = 'Form markup issues (Chrome):';
