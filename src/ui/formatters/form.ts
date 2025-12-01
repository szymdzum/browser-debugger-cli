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
import { OutputFormatter } from '@/ui/formatting.js';

const COLUMN_WIDTHS = {
  index: 4,
  type: 12,
  label: 24,
  value: 20,
  status: 10,
};

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
  if (field.disabled) {
    return 'disabled';
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
  const label = (field.label + formatRequiredMarker(field))
    .slice(0, COLUMN_WIDTHS.label)
    .padEnd(COLUMN_WIDTHS.label);
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
  let header = `Form: "${form.name ?? 'Unnamed'}"`;

  if (form.step) {
    header += ` (step ${form.step.current} of ${form.step.total})`;
  }

  return header;
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
 * Format summary line.
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

  if (summary.requiredRemaining > 0) {
    parts.push(`${summary.requiredRemaining} required remaining`);
  }

  if (summary.readyToSubmit) {
    parts.push('READY to submit');
  } else {
    parts.push('NOT ready');
  }

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
    if (!field.hidden) {
      fmt.text(formatFieldRow(field));
    }
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
 * Format brief field listing.
 *
 * @param form - Discovered form
 * @param fmt - Output formatter
 */
function formatBriefFields(form: DiscoveredForm, fmt: OutputFormatter): void {
  fmt.text('IDX  TYPE         LABEL                    REQ');
  fmt.text('─'.repeat(50));

  for (const field of form.fields) {
    if (field.hidden) continue;
    const idx = `[${field.index}]`.padEnd(4);
    const type = (field.inputType ?? field.type).slice(0, 11).padEnd(12);
    const label = (field.label ?? field.name ?? '(no label)').slice(0, 23).padEnd(24);
    const req = field.required ? '*' : '';
    fmt.text(`${idx} ${type} ${label} ${req}`);
  }

  if (form.buttons.length > 0) {
    fmt.text('─'.repeat(50));
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
 * @param forms - All forms
 * @param selectedIndex - Index of selected form
 * @param fmt - Output formatter
 */
function formatOtherForms(
  forms: DiscoveredForm[],
  selectedIndex: number,
  fmt: OutputFormatter
): void {
  const others = forms.filter((_, i) => i !== selectedIndex);

  if (others.length === 0) {
    return;
  }

  fmt.blank();
  fmt.text('Other forms on page:');

  for (const form of others) {
    const fieldCount = form.fields.filter((f) => !f.hidden).length;
    fmt.text(`  Form ${form.index}: "${form.name ?? 'Unnamed'}" - ${fieldCount} field(s)`);
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

  if (result.forms.length === 1 && result.formCount > 1) {
    const allForms: DiscoveredForm[] = [];
    for (let i = 0; i < result.formCount; i++) {
      if (i === result.selectedForm) {
        allForms.push(result.forms[0] as DiscoveredForm);
      } else {
        allForms.push({
          index: i,
          name: `Form ${i}`,
          action: null,
          method: 'GET',
          relevanceScore: 0,
          fields: [],
          buttons: [],
          summary: {
            totalFields: 0,
            filledFields: 0,
            emptyFields: 0,
            validFields: 0,
            invalidFields: 0,
            requiredTotal: 0,
            requiredFilled: 0,
            requiredRemaining: 0,
            readyToSubmit: true,
            blockers: [],
          },
        });
      }
    }
    formatOtherForms(allForms, result.selectedForm, fmt);
  }

  fmt.blank();
  fmt.text('Suggested commands:');
  fmt.text('  bdg dom fill <index> "<value>"     Fill a field');
  fmt.text('  bdg dom click <index>              Click/check a field or button');
  fmt.text('  bdg dom form                       Refresh to see current state');
  fmt.blank();
  fmt.text('Tip: Re-run "bdg dom form" after clicks that may reveal hidden fields');

  return fmt.build();
}
