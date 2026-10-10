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
 * Page-side list of a form's invalid fields: those the browser validates
 * that are not valid, each named by its name, id or tag, with the browser's
 * validation message. Reading `validity` fires no `invalid` events.
 */
export const INVALID_FIELDS_JS = `(form) => Array.from(form.elements)
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
 * and whether the form fired `submit`.
 */
export const SUBMIT_PROBE_JS = `(el) => {
  const button = el.closest('button') || el;
  const submits = (button.localName === 'button' && button.type === 'submit') ||
    (button.localName === 'input' && (button.type === 'submit' || button.type === 'image'));
  const form = submits ? button.form : null;
  if (!form || form.noValidate || button.formNoValidate) return;
  const probe = { form: form, click: null, submitted: false };
  const onClick = (event) => { probe.click = probe.click || event; };
  const onSubmit = () => { probe.submitted = true; };
  button.addEventListener('click', onClick, true);
  form.addEventListener('submit', onSubmit, true);
  probe.stop = () => {
    button.removeEventListener('click', onClick, true);
    form.removeEventListener('submit', onSubmit, true);
  };
  window.__bdgSubmitProbe = probe;
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
  if (!probe.click || probe.click.defaultPrevented || probe.submitted || !probe.form.isConnected) return null;
  const fields = (${INVALID_FIELDS_JS})(probe.form);
  return fields.length > 0 ? fields : null;
})()`;

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
