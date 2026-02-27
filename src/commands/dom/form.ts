/**
 * Form discovery command for semantic form inspection.
 *
 * Discovers forms on the page with semantic labels, current values,
 * validation state, and suggested commands for agent consumption.
 */

import type { Command } from 'commander';

import { FORM_DISCOVERY_SCRIPT, isRawFormData } from '@/commands/dom/formDiscovery.js';
import type {
  FormCommandOptions,
  FormDiscoveryResult,
  DiscoveredForm,
  FormField,
  FormButton,
  FormSummary,
  FormBlocker,
  FieldValidation,
  RawFormData,
  RawForm,
  RawField,
  RawButton,
  FieldState,
  FormFieldType,
} from '@/commands/dom/formTypes.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatFormDiscovery } from '@/ui/formatters/form.js';
import { noFormsFoundError, formInIframeError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Execute form discovery in page context.
 *
 * @param cdp - CDP connection
 * @returns Raw form data from page
 */
async function executeFormDiscovery(cdp: CDPConnection): Promise<RawFormData> {
  const response = await cdp.send('Runtime.evaluate', {
    expression: FORM_DISCOVERY_SCRIPT,
    returnByValue: true,
  });

  const cdpResponse = response as {
    exceptionDetails?: Protocol.Runtime.ExceptionDetails;
    result?: { value?: unknown };
  };

  if (cdpResponse.exceptionDetails) {
    throw new CommandError(
      `Form discovery failed: ${cdpResponse.exceptionDetails.text}`,
      { suggestion: 'Check if page has loaded completely' },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }

  const rawData = cdpResponse.result?.value;
  if (!isRawFormData(rawData)) {
    throw new CommandError(
      'Unexpected form discovery response',
      { suggestion: 'This may be a bug - please report it' },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }

  return rawData;
}

/**
 * Build validation state from raw field data.
 *
 * @param raw - Raw field data
 * @returns Structured validation state
 */
function buildValidation(raw: RawField): FieldValidation {
  const hasNativeError = !raw.isValid && raw.validationMessage;
  const hasAriaError = raw.ariaInvalid;
  const hasSiblingError = !!raw.siblingErrorText;
  const hasClassError = raw.hasErrorClass;

  if (hasNativeError) {
    return {
      valid: false,
      message: raw.validationMessage,
      source: 'native',
      confidence: 'high',
    };
  }

  if (hasAriaError) {
    return {
      valid: false,
      message: raw.siblingErrorText ?? 'Field is invalid',
      source: 'aria',
      confidence: 'high',
    };
  }

  if (hasSiblingError) {
    return {
      valid: false,
      message: raw.siblingErrorText,
      source: 'sibling',
      confidence: 'medium',
    };
  }

  if (hasClassError) {
    return {
      valid: false,
      message: 'Field has error styling',
      source: 'heuristic',
      confidence: 'low',
    };
  }

  return {
    valid: true,
    confidence: 'high',
  };
}

/**
 * Build field state from raw value.
 *
 * @param raw - Raw field data
 * @returns Field state
 */
function buildFieldState(raw: RawField): FieldState {
  const type = raw.type.toLowerCase();

  if (type === 'checkbox' || type === 'radio' || type === 'switch') {
    return raw.checked || raw.value === true ? 'checked' : 'unchecked';
  }

  if (Array.isArray(raw.value)) {
    return raw.value.length > 0 ? 'filled' : 'empty';
  }

  if (typeof raw.value === 'string') {
    return raw.value.length > 0 ? 'filled' : 'empty';
  }

  return 'empty';
}

/**
 * Build masked value for password fields.
 *
 * @param raw - Raw field data
 * @returns Masked value string
 */
function buildMaskedValue(raw: RawField): string | undefined {
  if (raw.inputType === 'password' && typeof raw.value === 'string' && raw.value.length > 0) {
    return '•'.repeat(Math.min(raw.value.length, 8));
  }
  return undefined;
}

/**
 * Build interaction warning for non-native fields.
 *
 * @param raw - Raw field data
 * @returns Warning message or undefined
 */
function buildInteractionWarning(raw: RawField): string | undefined {
  if (raw.native) {
    return undefined;
  }

  const type = raw.type.toLowerCase();

  if (type === 'contenteditable') {
    return 'Custom contenteditable - use click + type instead of fill';
  }

  if (type === 'combobox' || type === 'listbox') {
    return 'Custom dropdown - click to open, then select option';
  }

  if (type === 'textbox') {
    return 'Custom textbox - fill may not trigger framework events';
  }

  return 'Custom component - standard fill may not work';
}

/**
 * Build fill command for a field using selector.
 *
 * @param selector - CSS selector
 * @param type - Field type
 * @returns Command string
 */
function buildFieldCommand(selector: string, type: string): string {
  const lowerType = type.toLowerCase();
  // Escape backslashes first, then double quotes
  const escaped = selector.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  if (lowerType === 'checkbox' || lowerType === 'radio' || lowerType === 'switch') {
    return `bdg dom click "${escaped}"`;
  }

  if (lowerType === 'file') {
    return `bdg dom click "${escaped}"`;
  }

  return `bdg dom fill "${escaped}" "<value>"`;
}

/**
 * Build alternative command for non-native fields.
 *
 * @param selector - CSS selector
 * @param raw - Raw field data
 * @returns Alternative command or undefined
 */
function buildAlternativeCommand(selector: string, raw: RawField): string | undefined {
  if (raw.native) {
    return undefined;
  }

  const type = raw.type.toLowerCase();
  const escaped = selector.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  if (type === 'contenteditable' || type === 'textbox') {
    return `bdg dom click "${escaped}" && bdg dom pressKey "${escaped}" "<value>"`;
  }

  return undefined;
}

/**
 * Transform raw field to structured FormField.
 *
 * @param raw - Raw field data
 * @returns Structured FormField
 */
function transformField(raw: RawField): FormField {
  const command = buildFieldCommand(raw.selector, raw.type);
  return {
    index: raw.index,
    formIndex: raw.formIndex,
    selector: raw.selector,
    type: raw.type as FormFieldType,
    inputType: raw.inputType,
    label: raw.label,
    name: raw.name,
    placeholder: raw.placeholder,
    required: raw.required,
    disabled: raw.disabled,
    readOnly: raw.readOnly,
    hidden: raw.hidden,
    native: raw.native,
    interactionWarning: buildInteractionWarning(raw),
    state: buildFieldState(raw),
    value: raw.value,
    maskedValue: buildMaskedValue(raw),
    validation: buildValidation(raw),
    options: raw.options,
    command,
    selectorCommand: command,
    alternativeCommand: buildAlternativeCommand(raw.selector, raw),
  };
}

/**
 * Transform raw button to structured FormButton.
 *
 * @param raw - Raw button data
 * @returns Structured FormButton
 */
function transformButton(raw: RawButton): FormButton {
  const escaped = raw.selector.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return {
    index: raw.index,
    selector: raw.selector,
    label: raw.label,
    type: raw.type as 'submit' | 'reset' | 'button',
    primary: raw.isPrimary,
    enabled: !raw.disabled,
    disabledReason: raw.disabled ? 'Button is disabled' : undefined,
    command: `bdg dom click "${escaped}"`,
  };
}

/**
 * Calculate form summary statistics.
 *
 * @param fields - Transformed form fields
 * @param buttons - Transformed form buttons
 * @returns Form summary
 */
function calculateSummary(fields: FormField[], buttons: FormButton[]): FormSummary {
  const visibleFields = fields.filter((f) => !f.hidden);
  const requiredFields = visibleFields.filter((f) => f.required);
  const filledFields = visibleFields.filter((f) => f.state === 'filled' || f.state === 'checked');
  const validFields = visibleFields.filter((f) => f.validation.valid);
  const invalidFields = visibleFields.filter((f) => !f.validation.valid);
  const emptyRequired = requiredFields.filter(
    (f) => f.state === 'empty' || f.state === 'unchecked'
  );

  const blockers: FormBlocker[] = [];

  for (const field of emptyRequired) {
    blockers.push({
      index: field.index,
      label: field.label,
      reason: 'Required field is empty',
      command: field.command,
    });
  }

  for (const field of invalidFields) {
    if (!emptyRequired.includes(field)) {
      blockers.push({
        index: field.index,
        label: field.label,
        reason: field.validation.message ?? 'Validation failed',
        command: field.command,
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

  return {
    totalFields: visibleFields.length,
    filledFields: filledFields.length,
    emptyFields: visibleFields.length - filledFields.length,
    validFields: validFields.length,
    invalidFields: invalidFields.length,
    requiredTotal: requiredFields.length,
    requiredFilled: requiredFields.length - emptyRequired.length,
    requiredRemaining: emptyRequired.length,
    readyToSubmit: blockers.length === 0,
    blockers,
  };
}

/**
 * Transform raw form to structured DiscoveredForm.
 *
 * @param raw - Raw form data
 * @returns Structured DiscoveredForm
 */
function transformForm(raw: RawForm): DiscoveredForm {
  const fields = raw.fields.map(transformField);
  const buttons = raw.buttons.map(transformButton);

  return {
    index: raw.index,
    name: raw.name,
    action: raw.action,
    method: raw.method,
    step: raw.step ?? undefined,
    relevanceScore: raw.relevanceScore,
    fields,
    buttons,
    summary: calculateSummary(fields, buttons),
  };
}

/**
 * Execute CDP connection lifecycle for form discovery.
 *
 * @param fn - Function to execute with CDP connection
 * @returns Result from function
 */
async function withCDPConnection<T>(fn: (cdp: CDPConnection) => Promise<T>): Promise<T> {
  const { CDPConnection } = await import('@/connection/cdp.js');
  const { validateActiveSession, getValidatedSessionMetadata, verifyTargetExists } =
    await import('@/commands/dom/evalHelpers.js');

  validateActiveSession();
  const metadata = getValidatedSessionMetadata();
  if (!metadata.port) {
    throw new CommandError(
      'Session metadata missing port',
      { suggestion: 'Restart the session with: bdg stop && bdg <url>' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }
  await verifyTargetExists(metadata, metadata.port);

  const cdp = new CDPConnection();
  if (!metadata.webSocketDebuggerUrl) {
    throw new CommandError(
      'Session metadata missing webSocketDebuggerUrl',
      { suggestion: 'Start a new session with: bdg <url>' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }
  await cdp.connect(metadata.webSocketDebuggerUrl);

  try {
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

/**
 * Handle form discovery command.
 *
 * @param options - Command options
 */
async function handleFormCommand(options: FormCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      return await withCDPConnection(async (cdp) => {
        const rawData = await executeFormDiscovery(cdp);

        if (rawData.forms.length === 0) {
          const err = noFormsFoundError();
          return {
            success: false,
            error: err.message,
            exitCode: EXIT_CODES.NO_FORMS_FOUND,
            errorContext: { suggestion: err.suggestion },
          };
        }

        const iframeForm = rawData.forms.find((f) => f.inIframe);
        if (iframeForm && rawData.forms.length === 1) {
          const err = formInIframeError(
            iframeForm.iframeUrl ?? 'unknown',
            iframeForm.crossOrigin ?? false
          );
          return {
            success: false,
            error: err.message,
            exitCode: EXIT_CODES.FORM_IN_IFRAME,
            errorContext: { suggestion: err.suggestion },
          };
        }

        const allForms = rawData.forms.map(transformForm);
        const forms = options.all ? allForms : [allForms[0] as DiscoveredForm];

        const result: FormDiscoveryResult = {
          formCount: rawData.forms.length,
          selectedForm: 0,
          forms,
          brief: options.brief,
        };

        return { success: true, data: result };
      });
    },
    options,
    formatFormDiscovery
  );
}

/**
 * Register form discovery command.
 *
 * @param domCommand - DOM command group
 */
export function registerFormCommand(domCommand: Command): void {
  domCommand
    .command('form')
    .description('Discover forms with semantic labels, values, and validation state')
    .option('--all', 'Show all forms expanded')
    .option('--brief', 'Quick scan: field names, types, and required status only')
    .addOption(jsonOption())
    .action(async (options: FormCommandOptions) => {
      await handleFormCommand(options);
    });
}
