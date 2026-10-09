/**
 * Human-readable formatter for form discovery output.
 *
 * Formats discovered forms with semantic tables showing fields,
 * values, validation state, and suggested commands.
 */

import type {
  FormDiscoveryResult,
  DiscoveredForm,
  FormField,
  FormButton,
  FormSummary,
} from '@/types.js';
import { OutputFormatter, areHintsHidden } from '@/ui/formatting.js';
import {
  REQUIRED_FIELD_EMPTY_REASON,
  closedShadowRootMessage,
  formReadinessMessage,
  formsInFrameMessage,
  requiredFieldsEmptyMessage,
} from '@/ui/messages/commands.js';
import { PAGE_FORM_ISSUES_HEADING, fieldIssueLine } from '@/ui/messages/issueMessages.js';

const COLUMN_WIDTHS = {
  index: 4,
  type: 12,
  label: 24,
  value: 20,
  status: 10,
};

/**
 * Cut text to a column width, marking the cut with "…".
 *
 * @param text - Text
 * @param width - Column width
 * @returns Text of at most `width` characters
 */
function fitText(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/**
 * Format field type for display.
 *
 * @param field - Form field
 * @returns Formatted type string
 */
function formatFieldType(field: FormField): string {
  const type = field.inputType ?? field.type;
  return type.slice(0, COLUMN_WIDTHS.type - 1);
}

/**
 * Format field value for display.
 *
 * @param field - Form field
 * @returns Formatted value string
 */
function formatFieldValue(field: FormField): string {
  if (field.state === 'checked') {
    return 'checked';
  }

  if (field.state === 'unchecked') {
    return 'unchecked';
  }

  if (field.maskedValue) {
    return `"${field.maskedValue}"`;
  }

  if (typeof field.value === 'string' && field.value.length > 0) {
    const truncated = field.value.slice(0, COLUMN_WIDTHS.value - 3);
    return `"${truncated}${field.value.length > COLUMN_WIDTHS.value - 3 ? '...' : ''}"`;
  }

  if (Array.isArray(field.value) && field.value.length > 0) {
    return `[${field.value.length} selected]`;
  }

  return 'empty';
}

/**
 * Format field status with icon.
 *
 * @param field - Form field
 * @returns Status string with icon
 */
function formatFieldStatus(field: FormField): string {
  if (field.hidden) {
    return 'hidden';
  }

  if (field.disabled) {
    return 'disabled';
  }

  if (field.readOnly) {
    return 'read-only';
  }

  if (!field.validation.valid) {
    return 'invalid';
  }

  if (field.required && (field.state === 'empty' || field.state === 'unchecked')) {
    return 'required';
  }

  return 'ok';
}

/**
 * Format required marker.
 *
 * @param field - Form field
 * @returns Asterisk if required, empty string otherwise
 */
function formatRequiredMarker(field: FormField): string {
  return field.required ? '*' : '';
}

/**
 * Format field row for table.
 *
 * @param field - Form field
 * @returns Formatted row string
 */
function formatFieldRow(field: FormField): string {
  const idx = String(field.index).padStart(COLUMN_WIDTHS.index);
  const type = formatFieldType(field).padEnd(COLUMN_WIDTHS.type);
  const marker = formatRequiredMarker(field);
  const label = (fitText(field.label, COLUMN_WIDTHS.label - marker.length) + marker).padEnd(
    COLUMN_WIDTHS.label
  );
  const value = formatFieldValue(field).padEnd(COLUMN_WIDTHS.value);
  const status = formatFieldStatus(field);

  let warning = '';
  if (field.interactionWarning) {
    warning = ` [custom]`;
  }

  return `${idx}  ${type} ${label} ${value} ${status}${warning}`;
}

/**
 * Format button row for table.
 *
 * @param button - Form button
 * @returns Formatted row string
 */
function formatButtonRow(button: FormButton): string {
  const idx = String(button.index).padStart(COLUMN_WIDTHS.index);
  const type = 'button'.padEnd(COLUMN_WIDTHS.type);
  const label = button.label.slice(0, COLUMN_WIDTHS.label).padEnd(COLUMN_WIDTHS.label);
  const primary = button.primary ? '(primary)' : '(secondary)';
  const enabled = button.enabled ? 'enabled' : 'disabled';

  return `${idx}  ${type} ${label} ${primary.padEnd(COLUMN_WIDTHS.value)} ${enabled}`;
}

/**
 * Format form header with name and step indicator.
 *
 * @param form - Discovered form
 * @returns Header string
 */
function formatFormHeader(form: DiscoveredForm): string {
  let header = `Form: "${form.name ?? 'Unnamed'}"${formVisibilityMarker(form)}${shadowRootMarker(form)}`;

  if (form.step) {
    header += ` (step ${form.step.current} of ${form.step.total})`;
  }

  return header;
}

/**
 * Marker of a form shown in an open dialog or not shown at all.
 *
 * @param form - Form (or its listing in "Other forms")
 * @returns ` (in dialog)`, ` (hidden)`, or empty
 */
function formVisibilityMarker(form: Pick<DiscoveredForm, 'hidden' | 'inDialog'>): string {
  if (form.hidden) return ' (hidden)';
  return form.inDialog ? ' (in dialog)' : '';
}

/**
 * Marker of a form in a shadow root, like `dom query` shows elements there.
 *
 * @param form - Form (or its listing in "Other forms")
 * @returns ` (in shadow root of <x-login>)`, or empty
 */
function shadowRootMarker(form: Pick<DiscoveredForm, 'shadowHost'>): string {
  return form.shadowHost ? ` (in shadow root of <${form.shadowHost}>)` : '';
}

/**
 * Format table header row.
 *
 * @returns Header row string
 */
function formatTableHeader(): string {
  const idx = '#'.padStart(COLUMN_WIDTHS.index);
  const type = 'Type'.padEnd(COLUMN_WIDTHS.type);
  const label = 'Label'.padEnd(COLUMN_WIDTHS.label);
  const value = 'Value'.padEnd(COLUMN_WIDTHS.value);
  const status = 'Status';

  return `${idx}  ${type} ${label} ${value} ${status}`;
}

/**
 * Format summary line, e.g. "Summary: 1/3 fields filled | 2 required fields
 * empty: Last Name, Zip | NOT ready" (a radio or checkbox group counts as one
 * field).
 *
 * @param summary - Form summary
 * @returns Summary string
 */
function formatSummaryLine(summary: FormSummary): string {
  const parts: string[] = [];

  parts.push(`${summary.filledFields}/${summary.totalFields} fields filled`);

  if (summary.invalidFields > 0) {
    parts.push(`${summary.invalidFields} invalid`);
  }

  const requiredEmpty = summary.blockers
    .filter((blocker) => blocker.reason === REQUIRED_FIELD_EMPTY_REASON)
    .map((blocker) => blocker.label);
  if (requiredEmpty.length > 0) parts.push(requiredFieldsEmptyMessage(requiredEmpty));

  parts.push(formReadinessMessage(summary));

  return `Summary: ${parts.join(' | ')}`;
}

/**
 * Format remaining actions section.
 *
 * @param summary - Form summary
 * @returns Array of command strings
 */
function formatRemainingActions(summary: FormSummary): string[] {
  if (summary.blockers.length === 0) {
    return [];
  }

  return summary.blockers.slice(0, 5).map((b) => `  ${b.command.padEnd(35)} # ${b.label}`);
}

/**
 * Format single form for display.
 *
 * @param form - Discovered form
 * @param fmt - Output formatter
 */
function formatSingleForm(form: DiscoveredForm, fmt: OutputFormatter, brief = false): void {
  fmt.text(formatFormHeader(form));
  fmt.text('─'.repeat(70));

  if (brief) {
    formatBriefFields(form, fmt);
    return;
  }

  fmt.text(formatTableHeader());
  fmt.text('─'.repeat(70));

  for (const field of form.fields) {
    fmt.text(formatFieldRow(field));
    formatFieldIssues(field, fmt);
  }

  if (form.buttons.length > 0) {
    fmt.text('─'.repeat(70));
    for (const button of form.buttons) {
      fmt.text(formatButtonRow(button));
    }
  }

  fmt.text('═'.repeat(70));
  fmt.text(formatSummaryLine(form.summary));

  const remaining = formatRemainingActions(form.summary);
  if (remaining.length > 0) {
    fmt.blank();
    fmt.text('Remaining:');
    for (const action of remaining) {
      fmt.text(action);
    }
  }
}

/**
 * The form markup errors Chrome reports for a field, under its row.
 *
 * @param field - Form field
 * @param fmt - Output formatter
 */
function formatFieldIssues(field: FormField, fmt: OutputFormatter): void {
  for (const issue of field.issues ?? []) fmt.text(fieldIssueLine(issue));
}

/**
 * Form markup errors Chrome reports for elements that are no listed field.
 *
 * @param issues - Errors
 * @param fmt - Output formatter
 */
function formatPageFormIssues(
  issues: NonNullable<FormDiscoveryResult['formIssues']>,
  fmt: OutputFormatter
): void {
  if (issues.length === 0) return;
  fmt.text(PAGE_FORM_ISSUES_HEADING);
  for (const issue of issues) {
    const where = issue.elements?.length ? ` → ${issue.elements.join(', ')}` : '';
    fmt.text(`  • ${issue.text}${where}`);
  }
  fmt.blank();
}

/**
 * Format brief field listing.
 *
 * @param form - Discovered form
 * @param fmt - Output formatter
 */
function formatBriefFields(form: DiscoveredForm, fmt: OutputFormatter): void {
  fmt.text('IDX  TYPE         LABEL                    REQ VALUE');
  fmt.text('─'.repeat(70));

  for (const field of form.fields) {
    const idx = `[${field.index}]`.padEnd(4);
    const type = (field.inputType ?? field.type).slice(0, 11).padEnd(12);
    const label = (field.label ?? field.name ?? '(no label)').slice(0, 23).padEnd(24);
    const req = (field.required ? '*' : '').padEnd(3);
    const hidden = field.hidden ? ' (hidden)' : '';
    fmt.text(`${idx} ${type} ${label} ${req} ${formatFieldValue(field)}${hidden}`);
    formatFieldIssues(field, fmt);
  }

  if (form.buttons.length > 0) {
    fmt.text('─'.repeat(70));
    for (const button of form.buttons) {
      const idx = `[${button.index}]`.padEnd(4);
      const type = 'button'.padEnd(12);
      const label = (button.label || button.type).slice(0, 23).padEnd(24);
      fmt.text(`${idx} ${type} ${label}`);
    }
  }
}

/**
 * Format other forms summary.
 *
 * @param others - Forms not shown, with their visible field counts
 * @param fmt - Output formatter
 */
function formatOtherForms(
  others: NonNullable<FormDiscoveryResult['otherForms']>,
  fmt: OutputFormatter
): void {
  if (others.length === 0) return;
  fmt.blank();
  fmt.text('Other forms on page:');
  for (const form of others) {
    fmt.text(
      `  Form ${form.index}: "${form.name ?? 'Unnamed'}"${formVisibilityMarker(form)}${shadowRootMarker(form)} - ${form.fieldCount} field(s)`
    );
  }
  fmt.blank();
  fmt.text('Use --all to see all forms');
}

/**
 * Format form discovery result for human-readable display.
 *
 * @param result - Form discovery result
 * @returns Formatted output string
 */
export function formatFormDiscovery(result: FormDiscoveryResult): string {
  const fmt = new OutputFormatter();

  fmt.text(`FORMS DISCOVERED: ${result.formCount}`);
  fmt.text('═'.repeat(70));
  fmt.blank();

  for (const form of result.forms) {
    formatSingleForm(form, fmt, result.brief);
    fmt.blank();
  }

  if (result.otherForms) formatOtherForms(result.otherForms, fmt);
  if (result.formIssues) formatPageFormIssues(result.formIssues, fmt);

  for (const url of result.formsInFrames ?? []) {
    fmt.text(`Note: ${formsInFrameMessage(url)}`);
    fmt.blank();
  }
  for (const host of result.closedShadowHosts ?? []) {
    fmt.text(`Note: ${closedShadowRootMessage(host)}`);
    fmt.blank();
  }

  fmt.hints('Suggested commands:', [
    'bdg dom fill <index> "<value>"     Fill a field',
    'bdg dom click <index>              Click/check a field or button',
    'bdg dom form                       Refresh to see current state',
  ]);
  if (!areHintsHidden()) fmt.blank();
  fmt.tip('Tip: Re-run "bdg dom form" after clicks that may reveal hidden fields');

  return fmt.build();
}
