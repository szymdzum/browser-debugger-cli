/**
 * Whether a click on a submit button was blocked by the browser's
 * constraint validation, and by which fields: the click script installs a
 * probe on the button's form ({@link SUBMIT_PROBE_JS}) and the click's
 * result reads it ({@link readBlockedSubmit}). The fields are listed the way
 * `dom submit` lists them ({@link INVALID_FIELDS_JS}).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { InvalidField } from '@/ipc/protocol/domTypes.js';
import { createLogger } from '@/ui/logging/index.js';
import { raceTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/**
 * How long reading the probe may take: a page that does not answer by then
 * (a navigation still pending) is not reported as blocked
 */
const READ_TIMEOUT_MS = 250;

/**
 * Page-side access to a form's own members through the prototypes: a named
 * control (`<input name="elements">`, `name="addEventListener"`) shadows
 * the member of the same name on the form itself. `listen` and `unlisten`
 * work for any element.
 */
export const FORM_MEMBERS_JS = `({
  elements: (form) => Array.from(Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get.call(form)),
  noValidate: (form) => Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'noValidate').get.call(form),
  checkValidity: (form) => HTMLFormElement.prototype.checkValidity.call(form),
  requestSubmit: (form, submitter) => submitter
    ? HTMLFormElement.prototype.requestSubmit.call(form, submitter)
    : HTMLFormElement.prototype.requestSubmit.call(form),
  isConnected: (node) => Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected').get.call(node),
  listen: (node, type, listener) => EventTarget.prototype.addEventListener.call(node, type, listener, true),
  unlisten: (node, type, listener) => EventTarget.prototype.removeEventListener.call(node, type, listener, true)
})`;

/**
 * Page-side list of a form's invalid fields: those the browser validates
 * that are not valid, each named by its name, id or tag, with the browser's
 * validation message. Reading `validity` fires no `invalid` events.
 */
export const INVALID_FIELDS_JS = `(form) => (${FORM_MEMBERS_JS}).elements(form)
  .filter((f) => f.willValidate && !f.validity.valid)
  .map((f) => ({ field: f.name || f.id || f.tagName.toLowerCase(), message: f.validationMessage }))`;

/** Page-side statement removing the probe {@link SUBMIT_PROBE_JS} left */
export const CLEAR_SUBMIT_PROBE_JS = `if (window.__bdgSubmitProbe) {
    window.__bdgSubmitProbe.stop();
    delete window.__bdgSubmitProbe;
  }`;

/**
 * Page-side probe installed before a click on `el`, left in
 * `window.__bdgSubmitProbe`, when the click submits a form the browser
 * validates: `el` (or the `<button>` holding it) is a submit button (a
 * `<button>` of type submit, also without a type or with an unknown one, or
 * an `<input>` of type submit or image), its form owner (`.form`: the form
 * holding it or the one its `form` attribute names, reachable from the
 * button in a closed shadow root too) has no `novalidate` and the button no
 * `formnovalidate`. It notes the first click event that reached the button
 * and whether the form fired `submit`. Evaluates to whether it was installed;
 * a probe that cannot be installed (a page that broke the built-ins it calls)
 * never fails the click, which is then reported as before.
 */
export const SUBMIT_PROBE_JS = `(el) => {
  try {
    const members = ${FORM_MEMBERS_JS};
    const button = el.closest('button') || el;
    const submits = (button.localName === 'button' && button.type === 'submit') ||
      (button.localName === 'input' && (button.type === 'submit' || button.type === 'image'));
    const form = submits ? button.form : null;
    if (!form || members.noValidate(form) || button.formNoValidate) return false;
    const probe = { form: form, click: null, submitted: false };
    const onClick = (event) => { probe.click = probe.click || event; };
    const onSubmit = () => { probe.submitted = true; };
    members.listen(button, 'click', onClick);
    members.listen(form, 'submit', onSubmit);
    probe.stop = () => {
      members.unlisten(button, 'click', onClick);
      members.unlisten(form, 'submit', onSubmit);
    };
    window.__bdgSubmitProbe = probe;
    return true;
  } catch (error) {
    return false;
  }
}`;

/**
 * Reads and removes the probe {@link SUBMIT_PROBE_JS} left: the form's
 * invalid fields when a click reached the button, the page did not cancel
 * it, the form fired no `submit` and it still has invalid fields; null
 * otherwise (no probe, a submit, a canceled click, a form removed).
 */
const READ_SUBMIT_PROBE_SCRIPT = `(() => {
  const probe = window.__bdgSubmitProbe;
  if (!probe) return null;
  probe.stop();
  delete window.__bdgSubmitProbe;
  if (!probe.click || probe.click.defaultPrevented || probe.submitted) return null;
  if (!(${FORM_MEMBERS_JS}).isConnected(probe.form)) return null;
  const fields = (${INVALID_FIELDS_JS})(probe.form);
  return fields.length > 0 ? fields : null;
})()`;

/** A form's invalid fields as reported: the first ones, and how many more there were */
export interface BoundedInvalidFields {
  fields: InvalidField[];
  /** Invalid fields left out of `fields` */
  omitted: number;
}

/**
 * Bound a form's invalid fields for a report.
 *
 * @param fields - Invalid fields as the page listed them
 * @returns The fields to report, and how many were left out
 */
export function boundInvalidFields(fields: InvalidField[]): BoundedInvalidFields {
  return { fields, omitted: 0 };
}

/**
 * The fields that blocked a click's submit, read from the probe the click
 * left ({@link READ_SUBMIT_PROBE_SCRIPT}) within {@link READ_TIMEOUT_MS}.
 *
 * @param cdp - Connection the click script ran on
 * @returns The invalid fields, or undefined when the submit was not blocked
 *   (or the page did not answer)
 */
export async function readBlockedSubmit(cdp: CDPConnection): Promise<InvalidField[] | undefined> {
  const read = async (): Promise<InvalidField[] | undefined> => {
    try {
      const reply = (await cdp.send('Runtime.evaluate', {
        expression: READ_SUBMIT_PROBE_SCRIPT,
        returnByValue: true,
      })) as { result?: { value?: InvalidField[] | null } };
      return reply.result?.value ?? undefined;
    } catch (error) {
      log.debug(`Submit probe not read: ${getErrorMessage(error)}`);
      return undefined;
    }
  };
  return raceTimeout(read(), READ_TIMEOUT_MS);
}
