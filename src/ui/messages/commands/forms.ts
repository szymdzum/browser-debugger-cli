/**
 * Form and dialog messages.
 */

import type { InvalidField, PendingChanges, ValidityReport } from '@/ipc/protocol/domTypes.js';
import { pluralize } from '@/ui/formatting.js';
import { fetchPausedNote } from '@/ui/messages/cdpEvents.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { fieldLabelList } from './shared.js';

/**
 * Part of the `bdg dom form` summary naming the required fields left empty.
 *
 * @param labels - Labels of the empty required fields
 * @returns e.g. "2 required fields empty: Last Name, Zip"
 */
export function requiredFieldsEmptyMessage(labels: string[]): string {
  const fields = labels.length === 1 ? 'field' : 'fields';
  return `${labels.length} required ${fields} empty: ${fieldLabelList(labels)}`;
}

/**
 * Note on a same-origin iframe holding form fields while `bdg dom form`
 * lists other forms of the page (it lists the main document's only).
 *
 * @param url - The iframe's URL
 * @returns e.g. "an iframe holds form fields dom form does not list: https://…/login; …"
 */
export function formsInFrameMessage(url: string): string {
  return `an iframe holds form fields dom form does not list: ${url}; reach them with bdg dom query "input, select, textarea", then bdg dom fill <index> <value>`;
}

/**
 * Note on a component whose closed shadow root holds form fields: page
 * scripts cannot reach a closed root, so `bdg dom form` cannot list them;
 * the accessibility tree holds them, and `dom fill` accepts its query indices.
 *
 * @param host - Short name of the component, e.g. `x-vault#pay`
 * @returns e.g. "<x-vault> has a closed shadow root with form fields; closed shadow roots are not inspectable, so they are not listed; reach them with bdg dom a11y query role=textbox, then bdg dom fill <index> <value>"
 */
export function closedShadowRootMessage(host: string): string {
  return `<${host}> has a closed shadow root with form fields; closed shadow roots are not inspectable, so they are not listed; reach them with bdg dom a11y query role=textbox, then bdg dom fill <index> <value>`;
}

/** Readiness of a form without visible, editable fields (e.g. only a hidden token) */
export const NO_VISIBLE_FIELDS = 'no visible fields to fill';

/**
 * Readiness at the end of the `bdg dom form` summary. A form without
 * visible, editable fields is not called ready: nothing on it was checked.
 *
 * @param summary - Whether the form is ready, how many fields it has, are
 *   filled and required, and the labels of the empty ones
 * @returns e.g. "READY to submit", "NOT ready (no fields filled)", "no visible fields to fill"
 */
export function formReadinessMessage(summary: {
  readyToSubmit: boolean;
  totalFields: number;
  filledFields: number;
  requiredTotal: number;
  emptyFieldLabels: string[];
}): string {
  if (summary.totalFields === 0) return NO_VISIBLE_FIELDS;
  if (!summary.readyToSubmit) {
    return summary.filledFields === 0 ? 'NOT ready (no fields filled)' : 'NOT ready';
  }
  if (summary.requiredTotal > 0 || summary.emptyFieldLabels.length === 0) return 'READY to submit';
  return `READY to submit (no field is marked required; empty: ${fieldLabelList(summary.emptyFieldLabels)})`;
}

/** Why an action's status line is not a clean success when nothing changed */
export const NO_VISIBLE_EFFECT =
  'no visible effect observed: no DOM change, requests or navigation within 300 ms';

/**
 * Status line of a DOM action: a check mark only for a clean success. A
 * blocked submit says so instead of "no visible effect" (the line below it
 * names the fields), and so does a navigation that ended on Chrome's error
 * page (#873).
 *
 * @param done - What was done, e.g. "Element Clicked"
 * @param state - Whether the action has warnings (shown right below), had its
 *   submit blocked by validation, had no visible effect, or returned while the
 *   page was still changing; the network error of a navigation that failed
 * @returns e.g. "✓ Element Clicked", "⚠ Element Clicked (with warnings)",
 *   "⚠ Element Clicked (navigation failed: net::ERR_CONNECTION_REFUSED)",
 *   "⚠ Element Clicked (submit blocked)",
 *   "⚠ Element Clicked (page still changing)" or
 *   "⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms)"
 */
export function actionStatusLine(
  done: string,
  state: {
    warned: boolean;
    noEffect?: boolean;
    stillChanging?: boolean;
    submitBlocked?: boolean;
    navigationFailed?: string;
  }
): string {
  if (state.noEffect && !state.submitBlocked && !state.navigationFailed)
    return `⚠ ${done} (${NO_VISIBLE_EFFECT})`;
  const notes = [
    state.navigationFailed && `navigation failed: ${state.navigationFailed}`,
    state.submitBlocked && 'submit blocked',
    state.warned && 'with warnings',
    state.stillChanging && 'page still changing',
  ];
  const shown = notes.filter((note): note is string => typeof note === 'string');
  return shown.length > 0 ? `⚠ ${done} (${shown.join('; ')})` : `✓ ${done}`;
}

/**
 * A form's invalid fields as `dom submit`'s error and a blocked click name
 * them, with how many more there were.
 *
 * @param fields - Invalid fields with the browser's messages
 * @param omitted - Invalid fields left out
 * @returns e.g. "email: Please fill out this field.; pin: Please fill out this field.; and 2 more"
 */
export function invalidFieldsText(fields: InvalidField[], omitted = 0): string {
  const named = fields.map((field) => `${field.field}: ${field.message}`);
  return [...named, ...(omitted > 0 ? [`and ${omitted} more`] : [])].join('; ');
}

/**
 * Note under the status line of a click whose submit the browser's
 * constraint validation blocked.
 *
 * @param fields - Fields that blocked it
 * @param omitted - Fields that blocked it, left out of `fields`
 * @returns e.g. "Submit blocked: email: Please fill out this field."
 */
export function submitBlockedNote(fields: InvalidField[], omitted = 0): string {
  return `Submit blocked: ${invalidFieldsText(fields, omitted)}`;
}

/**
 * Note under the status line of an action that returned while the page was
 * still changing; while Fetch interception is on, pending requests may be
 * paused by it, which the note says.
 *
 * @param action - What returned, e.g. "click", "key press"
 * @param pending - What the page was still working on
 * @param fetchInterception - Fetch interception is on
 * @returns e.g. "The page was still changing when the click returned (2 requests pending); wait for the result with bdg dom wait <selector>"
 */
export function stillChangingNote(
  action: string,
  pending: PendingChanges,
  fetchInterception = false
): string {
  const paused = fetchInterception ? `, ${fetchPausedNote()}` : '';
  const parts = [
    pending.requests !== undefined && `${pluralize(pending.requests, 'request')} pending${paused}`,
    pending.navigation && 'a new page still loading',
    pending.loading !== undefined && `loading indicator ${pending.loading} shown`,
    pending.domChanging && 'DOM still changing',
    pending.busy && 'page busy running a script',
  ].filter((part): part is string => typeof part === 'string');
  const wait = sessionCommand('bdg dom wait <selector>');
  return `The page was still changing when the ${action} returned (${parts.join(', ')}); wait for the result with ${wait}`;
}

/**
 * Why a secret field is invalid, from its validity state (#643): the
 * browser's text would say how long the value is.
 *
 * @param validity - Validity flags and length limits
 * @returns e.g. "tooShort: at least 8 characters", "valueMissing", or "invalid"
 */
export function validityStateText(validity: ValidityReport): string {
  const limits: Record<string, string | undefined> = {
    tooShort:
      validity.minLength === undefined ? undefined : `at least ${validity.minLength} characters`,
    tooLong:
      validity.maxLength === undefined ? undefined : `at most ${validity.maxLength} characters`,
  };
  const named = validity.states.map((state) => {
    const limit = limits[state];
    return limit === undefined ? state : `${state}: ${limit}`;
  });
  return named.length > 0 ? named.join(', ') : 'invalid';
}
