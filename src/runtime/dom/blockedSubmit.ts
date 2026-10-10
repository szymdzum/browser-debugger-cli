/**
 * Whether a click on a submit button, or Enter in a form field (or Space on
 * a submit button), was blocked
 * by the browser's constraint validation, and by which fields: the click
 * script installs a probe on the button's form ({@link SUBMIT_PROBE_JS}),
 * the key press script one for the submit the key starts
 * ({@link KEY_SUBMIT_PROBE_JS}) and a watch for `invalid` events
 * ({@link WATCH_INVALID_JS}), and the action's result reads them
 * ({@link readBlockedSubmit}). The fields are listed the way
 * `dom submit` lists them ({@link INVALID_FIELDS_JS}).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { InvalidField } from '@/ipc/protocol/domTypes.js';
import { createLogger } from '@/ui/logging/index.js';
import { raceTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { truncateByLength } from '@/utils/strings.js';

const log = createLogger('dom');

/**
 * How long reading the probe may take: a page that does not answer by then
 * (a navigation still pending) is not reported as blocked
 */
const READ_TIMEOUT_MS = 250;

/** Invalid fields a report lists; the rest are counted */
const MAX_REPORTED_FIELDS = 5;

/** Longest field name or validation message a report shows */
const MAX_FIELD_TEXT_LENGTH = 200;

/**
 * Whether a character is a control character (C0, DEL, C1) or a bidi
 * override, which page text may hold.
 *
 * @param char - One character
 * @returns True for those
 */
function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

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

/** Page-side test of whether a field the browser validates is invalid now */
const IS_INVALID_JS = `(f) => f.willValidate && !f.validity.valid`;

/**
 * Page-side entry naming an invalid field by its name, id or tag, with the
 * browser's validation message
 */
const FIELD_ENTRY_JS = `(f) => ({ field: f.name || f.id || f.tagName.toLowerCase(), message: f.validationMessage })`;

/**
 * Page-side list of a form's invalid fields: those the browser validates
 * that are not valid, each named by its name, id or tag, with the browser's
 * validation message. Reading `validity` fires no `invalid` events.
 */
export const INVALID_FIELDS_JS = `(form) => (${FORM_MEMBERS_JS}).elements(form)
  .filter(${IS_INVALID_JS})
  .map(${FIELD_ENTRY_JS})`;

/**
 * Page-side statement removing the probe ({@link SUBMIT_PROBE_JS}) and the
 * `invalid` watch ({@link WATCH_INVALID_JS}) an earlier action left
 */
export const CLEAR_SUBMIT_PROBE_JS = `if (window.__bdgSubmitProbe) {
    window.__bdgSubmitProbe.stop();
    delete window.__bdgSubmitProbe;
  }
  if (window.__bdgInvalidWatch) {
    window.__bdgInvalidWatch.stop();
    delete window.__bdgInvalidWatch;
  }`;

/**
 * Page-side test of whether an element is a submit button: a `<button>` of
 * type submit (also without a type or with an unknown one), or an
 * `<input>` of type submit or image.
 */
const IS_SUBMIT_BUTTON_JS = `(el) =>
  (el.localName === 'button' && el.type === 'submit') ||
  (el.localName === 'input' && (el.type === 'submit' || el.type === 'image'))`;

/**
 * Page-side installer of the probe left in `window.__bdgSubmitProbe`: it
 * notes the first `type` event (the trigger) that reached `target` and
 * whether `form` fired `submit`. Returns true.
 */
const INSTALL_SUBMIT_PROBE_JS = `(members, target, type, form) => {
  const probe = { form: form, trigger: null, submitted: false };
  const onTrigger = (event) => { probe.trigger = probe.trigger || event; };
  const onSubmit = () => { probe.submitted = true; };
  members.listen(target, type, onTrigger);
  members.listen(form, 'submit', onSubmit);
  probe.stop = () => {
    members.unlisten(target, type, onTrigger);
    members.unlisten(form, 'submit', onSubmit);
  };
  window.__bdgSubmitProbe = probe;
  return true;
}`;

/**
 * Page-side probe installed before a click on `el`, left in
 * `window.__bdgSubmitProbe`, when the click submits a form the browser
 * validates: `el` (or the `<button>` holding it) is a submit button
 * ({@link IS_SUBMIT_BUTTON_JS}), its form owner (`.form`: the form
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
    const form = (${IS_SUBMIT_BUTTON_JS})(button) ? button.form : null;
    if (!form || members.noValidate(form) || button.formNoValidate) return false;
    return (${INSTALL_SUBMIT_PROBE_JS})(members, button, 'click', form);
  } catch (error) {
    return false;
  }
}`;

/**
 * Input types that trigger implicit submission when the form has no submit
 * button (Chrome's text fields; the HTML spec's "fields that block implicit
 * submission" also name the date and time types, which Chrome does not)
 */
const IMPLICIT_SUBMIT_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password', 'number'];

/**
 * Page-side probe installed before a key press on the focused `el`, when
 * the key submits a form the browser validates, as Chrome submits:
 * - on a submit button, Enter and Space click it (Space on keyup): the
 *   click probe ({@link SUBMIT_PROBE_JS}) on it;
 * - for Enter in a field of a form with a submit button, Chrome clicks the
 *   form's first one in tree order (its default button, an image input
 *   too, which `form.elements` leaves out; a disabled one gets no click):
 *   the click probe on that button;
 * - for Enter in a text field ({@link IMPLICIT_SUBMIT_TYPES}) of a form
 *   without a submit button and with no other text field, the form is
 *   submitted: a probe noting the Enter `keypress` on the field (a
 *   canceled one submits nothing), when the form has no `novalidate`.
 * Other keys, a `<textarea>` (Enter adds a line), a form with several text
 * fields and no button, and elements outside a form get no probe.
 * Evaluates to whether it was installed; like the click probe it never
 * fails the key press.
 */
export const KEY_SUBMIT_PROBE_JS = `(el, key) => {
  try {
    const members = ${FORM_MEMBERS_JS};
    const isSubmitButton = ${IS_SUBMIT_BUTTON_JS};
    if (isSubmitButton(el)) return (${SUBMIT_PROBE_JS})(el);
    const form = key === 'Enter' && el.localName === 'input' ? el.form : null;
    if (!form) return false;
    const root = el.getRootNode();
    const query = (root.nodeType === 9 ? Document : DocumentFragment).prototype.querySelectorAll;
    const defaultButton = Array.from(query.call(root, 'button, input[type=submit], input[type=image]'))
      .find((c) => c.form === form && isSubmitButton(c));
    if (defaultButton) return (${SUBMIT_PROBE_JS})(defaultButton);
    const triggers = ${JSON.stringify(IMPLICIT_SUBMIT_TYPES)};
    const triggerCount = members.elements(form)
      .filter((c) => c.localName === 'input' && triggers.includes(c.type)).length;
    if (!triggers.includes(el.type) || triggerCount !== 1 || members.noValidate(form)) return false;
    return (${INSTALL_SUBMIT_PROBE_JS})(members, el, 'keypress', form);
  } catch (error) {
    return false;
  }
}`;

/**
 * Page-side watch installed right before a key press that starts a submit
 * (when {@link KEY_SUBMIT_PROBE_JS} installed its probe; after focusing
 * `el`, so a validity check the page runs on blur is left out), left in
 * `window.__bdgInvalidWatch`: it notes the fields that fired `invalid`
 * and whether any form fired `submit`, in the capture phase on the window
 * and on `el`'s shadow root (open or closed; neither event leaves a shadow
 * root). It sees a submit the page's own Enter handler blocks
 * (`requestSubmit()` on an invalid form, a site's own validation), which
 * no button click or `keypress` shows. Evaluates to whether it was
 * installed; it never fails the key press.
 */
export const WATCH_INVALID_JS = `(el) => {
  try {
    const members = ${FORM_MEMBERS_JS};
    const watch = { fields: [], submitted: false };
    const onInvalid = (event) => {
      if (!watch.fields.includes(event.target)) watch.fields.push(event.target);
    };
    const onSubmit = () => { watch.submitted = true; };
    const root = el.getRootNode();
    const scopes = root.nodeType === 11 ? [window, root] : [window];
    scopes.forEach((scope) => {
      members.listen(scope, 'invalid', onInvalid);
      members.listen(scope, 'submit', onSubmit);
    });
    watch.stop = () => scopes.forEach((scope) => {
      members.unlisten(scope, 'invalid', onInvalid);
      members.unlisten(scope, 'submit', onSubmit);
    });
    window.__bdgInvalidWatch = watch;
    return true;
  } catch (error) {
    return false;
  }
}`;

/**
 * Reads and removes the probe ({@link SUBMIT_PROBE_JS},
 * {@link KEY_SUBMIT_PROBE_JS}) and the `invalid` watch
 * ({@link WATCH_INVALID_JS}) the action left, and lists the fields that
 * blocked its submit, each once, those of the probe's form first:
 * - the probe's form's invalid fields, when its trigger (a click on the
 *   button, an Enter keypress on the field) reached it, the page did not
 *   cancel it, the form fired no `submit` and it still has invalid fields;
 * - the fields that fired `invalid` and are still invalid, when no form
 *   fired `submit`.
 * Null when there are none (no probe, a submit, a canceled trigger, a form
 * removed).
 */
const READ_SUBMIT_PROBE_SCRIPT = `(() => {
  const members = ${FORM_MEMBERS_JS};
  const isInvalid = ${IS_INVALID_JS};
  const probe = window.__bdgSubmitProbe;
  const watch = window.__bdgInvalidWatch;
  if (probe) {
    probe.stop();
    delete window.__bdgSubmitProbe;
  }
  if (watch) {
    watch.stop();
    delete window.__bdgInvalidWatch;
  }
  const blocked = [];
  if (probe && probe.trigger && !probe.trigger.defaultPrevented && !probe.submitted &&
      members.isConnected(probe.form)) {
    blocked.push(...members.elements(probe.form).filter(isInvalid));
  }
  if (watch && !watch.submitted) {
    blocked.push(...watch.fields.filter((f) => members.isConnected(f) && isInvalid(f)));
  }
  const fields = Array.from(new Set(blocked)).map(${FIELD_ENTRY_JS});
  return fields.length > 0 ? fields : null;
})()`;

/** A form's invalid fields as reported: the first ones, and how many more there were */
export interface BoundedInvalidFields {
  fields: InvalidField[];
  /** Invalid fields left out of `fields` */
  omitted: number;
}

/**
 * A page-provided name or message on one line: control characters and
 * line breaks become spaces, runs of whitespace one space, cut to
 * {@link MAX_FIELD_TEXT_LENGTH} characters.
 *
 * @param text - Name or message from the page
 * @returns Text for a report
 */
function fieldText(text: string): string {
  const spaced = Array.from(text, (char) => (isControlCharacter(char) ? ' ' : char)).join('');
  const line = spaced.replace(/\s+/g, ' ').trim();
  return truncateByLength(line, MAX_FIELD_TEXT_LENGTH);
}

/**
 * Bound a form's invalid fields for a report: the first
 * {@link MAX_REPORTED_FIELDS}, names and messages on one line and cut
 * ({@link fieldText}).
 *
 * @param fields - Invalid fields as the page listed them
 * @returns The fields to report, and how many were left out
 */
export function boundInvalidFields(fields: InvalidField[]): BoundedInvalidFields {
  return {
    fields: fields
      .slice(0, MAX_REPORTED_FIELDS)
      .map((f) => ({ field: fieldText(f.field), message: fieldText(f.message) })),
    omitted: Math.max(0, fields.length - MAX_REPORTED_FIELDS),
  };
}

/**
 * The fields that blocked the submit a click or key press started, read from
 * the probe the action left ({@link READ_SUBMIT_PROBE_SCRIPT}) within {@link READ_TIMEOUT_MS},
 * bounded ({@link boundInvalidFields}).
 *
 * @param cdp - Connection the action's script ran on
 * @returns The invalid fields, or undefined when the submit was not blocked
 *   (or the page did not answer)
 */
export async function readBlockedSubmit(
  cdp: CDPConnection
): Promise<BoundedInvalidFields | undefined> {
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
  const fields = await raceTimeout(read(), READ_TIMEOUT_MS);
  return fields && boundInvalidFields(fields);
}
