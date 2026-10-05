/**
 * Readiness of a discovered form (`bdg dom form`): which fields are filled,
 * which required ones are still empty, and which button submits it.
 */

import type {
  FormBlocker,
  FormButton,
  FormField,
  FormSummary,
  RawButton,
} from '@/runtime/dom/formTypes.js';
import { REQUIRED_FIELD_EMPTY_REASON } from '@/ui/messages/commands.js';

/** Button labels that leave or clear a form instead of submitting it */
const DISMISSIVE_BUTTON_LABEL =
  /^(cancel|reset|back|go back|previous|prev|close|clear|discard|delete|remove)\b/i;

/**
 * Fields a user fills as one: the options of a radio or checkbox group (same
 * name in the same form), or a single field.
 *
 * @param fields - Form fields
 * @returns Groups, in the order their first field appears
 */
export function groupFields(fields: FormField[]): FormField[][] {
  const groups = new Map<string, FormField[]>();
  for (const field of fields) {
    const type = (field.inputType ?? field.type).toLowerCase();
    const choice = (type === 'radio' || type === 'checkbox') && field.name;
    const key = choice ? `${field.formIndex}:${type}:${field.name}` : `#${field.index}`;
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }
  return [...groups.values()];
}

/**
 * Whether a field has a value (a checked option for radios and checkboxes).
 *
 * @param field - Form field
 * @returns True when filled or checked
 */
function isFilled(field: FormField): boolean {
  return field.state === 'filled' || field.state === 'checked';
}

/**
 * Label of a field group: the group's name (legend, radiogroup label, name)
 * for several options, the field's own label otherwise.
 *
 * @param group - Fields of one group (at least one)
 * @returns Label
 */
function groupLabel(group: FormField[]): string {
  const [first] = group as [FormField, ...FormField[]];
  return group.length > 1 ? (first.groupLabel ?? first.label) : first.label;
}

/**
 * What keeps a form from being submitted: required groups left empty,
 * invalid fields, a disabled submit button.
 *
 * @param groups - Field groups of the editable, visible fields
 * @param buttons - Form buttons
 * @returns Blockers, required fields first
 */
function findBlockers(groups: FormField[][], buttons: FormButton[]): FormBlocker[] {
  const blockers: FormBlocker[] = [];
  for (const group of groups) {
    const first = group[0] as FormField;
    if (group.some((field) => field.required) && !group.some(isFilled)) {
      blockers.push({
        index: first.index,
        label: groupLabel(group),
        reason: REQUIRED_FIELD_EMPTY_REASON,
        command: first.command,
      });
      continue;
    }
    const invalid = group.find((field) => !field.validation.valid);
    if (invalid) {
      blockers.push({
        index: invalid.index,
        label: invalid.label,
        reason: invalid.validation.message ?? 'Validation failed',
        command: invalid.command,
      });
    }
  }
  const submitButton = buttons.find((b) => b.type === 'submit' && b.primary);
  if (submitButton && !submitButton.enabled) {
    blockers.push({
      index: submitButton.index,
      label: submitButton.label,
      reason: submitButton.disabledReason ?? 'Submit button is disabled',
      command: submitButton.command,
    });
  }
  return blockers;
}

/**
 * Summarize a form's state. Only visible, editable fields count, and a radio
 * or checkbox group counts once (filled when any option is checked; required
 * when any option is). The form is ready when nothing blocks it and at least
 * one field is filled (an untouched form is not ready), or it has no fields.
 *
 * @param fields - Form fields
 * @param buttons - Form buttons
 * @returns Form summary
 */
export function calculateSummary(fields: FormField[], buttons: FormButton[]): FormSummary {
  const editable = fields.filter((f) => !f.hidden && !f.disabled && !f.readOnly);
  const groups = groupFields(editable);
  const filled = groups.filter((group) => group.some(isFilled));
  const empty = groups.filter((group) => !group.some(isFilled));
  const required = groups.filter((group) => group.some((field) => field.required));
  const requiredRemaining = required.filter((group) => !group.some(isFilled)).length;
  const invalid = groups.filter((group) => group.some((field) => !field.validation.valid)).length;
  const blockers = findBlockers(groups, buttons);

  return {
    totalFields: groups.length,
    filledFields: filled.length,
    emptyFields: empty.length,
    validFields: groups.length - invalid,
    invalidFields: invalid,
    requiredTotal: required.length,
    requiredFilled: required.length - requiredRemaining,
    requiredRemaining,
    emptyFieldLabels: empty.map(groupLabel),
    readyToSubmit: blockers.length === 0 && (filled.length > 0 || groups.length === 0),
    blockers,
  };
}

/**
 * The button that submits the form, as a user would pick it: never one that
 * cancels, resets or goes back; first a button written as a submit button
 * (`type="submit"`, `<input type=submit>`), then the form's default button
 * (a `<button>` without a type inside a form), then one styled as primary.
 * Buttons outside a form submit nothing, so only their style counts.
 *
 * @param buttons - Raw buttons of one form
 * @returns Index of the primary button, or undefined when there is none
 */
export function primaryButtonIndex(buttons: RawButton[]): number | undefined {
  const candidates = buttons.filter(
    (button) => button.type !== 'reset' && !DISMISSIVE_BUTTON_LABEL.test(button.label.trim())
  );
  const primary =
    candidates.find((button) => button.explicitSubmit) ??
    candidates.find((button) => button.formDefault) ??
    candidates.find((button) => button.primaryClass);
  return primary?.index;
}
