/**
 * Form discovery command for semantic form inspection.
 *
 * Discovers forms on the page with semantic labels, current values,
 * validation state, and suggested commands for agent consumption.
 */

import type { Command } from 'commander';

import { calculateSummary, orderForms, primaryButtonIndex } from '@/commands/dom/formSummary.js';
import { pageDocumentId, resolveBackendNodeIds } from '@/commands/dom/helpers/index.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { FormCommandOptions } from '@/commands/shared/optionTypes.js';
import { noFormsFoundError, formInIframeError } from '@/errors/messages.js';
import { domFormDiscover } from '@/ipc/client.js';
import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import type {
  FormDiscoveryResult,
  DiscoveredForm,
  FormField,
  FormButton,
  FieldValidation,
  RawForm,
  RawField,
  RawButton,
  FieldState,
  FormFieldType,
} from '@/runtime/dom/formTypes.js';
import { FORM_DISCOVERY_CACHE_SELECTOR, QueryCacheManager } from '@/session/QueryCacheManager.js';
import { formatFormDiscovery } from '@/ui/formatters/form.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/**
 * Build validation state from raw field data.
 *
 * @param raw - Raw field data
 * @returns Structured validation state
 */
function buildValidation(raw: RawField): FieldValidation {
  const hasNativeError = !raw.isValid && !raw.valueMissing && raw.validationMessage;
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
 * The masked value of a sensitive field (the page script never sends its
 * real value).
 *
 * @param raw - Raw field data
 * @returns Masked value string
 */
function buildMaskedValue(raw: RawField): string | undefined {
  return raw.value === MASKED_VALUE ? MASKED_VALUE : undefined;
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

  if (type === 'contenteditable') return undefined;

  if (type === 'combobox' || type === 'listbox') {
    return 'Custom dropdown - click to open, then select option';
  }

  if (type === 'textbox') {
    return 'Custom textbox - if fill has no effect, click it and type with pressKey (one key per call)';
  }

  return 'Custom component - standard fill may not work';
}

/**
 * Whether a user could change the field.
 *
 * @param raw - Raw field data
 * @returns False for disabled and read-only fields
 */
function editable(raw: RawField): boolean {
  return !raw.disabled && !raw.readOnly;
}

/**
 * Build fill command for a field.
 *
 * @param index - Global element index
 * @param type - Field type
 * @returns Command string
 */
function buildFieldCommand(index: number, type: string): string {
  const lowerType = type.toLowerCase();

  if (lowerType === 'checkbox' || lowerType === 'radio' || lowerType === 'switch') {
    return `bdg dom click ${index}`;
  }

  if (lowerType === 'file') {
    return `bdg dom fill ${index} "<path>"`;
  }

  return `bdg dom fill ${index} "<value>"`;
}

/**
 * Build selector-based command for a field.
 *
 * @param selector - CSS selector
 * @param type - Field type
 * @returns Command string
 */
function buildSelectorCommand(selector: string, type: string): string {
  const lowerType = type.toLowerCase();
  // Escape backslashes first, then double quotes (CodeQL js/incomplete-string-escaping)
  const escaped = selector.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  if (lowerType === 'checkbox' || lowerType === 'radio' || lowerType === 'switch') {
    return `bdg dom click "${escaped}"`;
  }

  if (lowerType === 'file') {
    return `bdg dom fill "${escaped}" "<path>"`;
  }

  return `bdg dom fill "${escaped}" "<value>"`;
}

/**
 * Transform raw field to structured FormField.
 *
 * @param raw - Raw field data
 * @returns Structured FormField
 */
function transformField(raw: RawField): FormField {
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
    groupLabel: raw.groupLabel,
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
    ...(raw.issues && { issues: raw.issues }),
    command: editable(raw) ? buildFieldCommand(raw.index, raw.type) : '',
    selectorCommand: editable(raw) ? buildSelectorCommand(raw.selector, raw.type) : '',
  };
}

/**
 * Transform raw button to structured FormButton.
 *
 * @param raw - Raw button data
 * @param primaryIndex - Index of the form's primary button, if any
 * @returns Structured FormButton
 */
function transformButton(raw: RawButton, primaryIndex: number | undefined): FormButton {
  return {
    index: raw.index,
    selector: raw.selector,
    label: raw.label,
    type: raw.type as 'submit' | 'reset' | 'button',
    primary: raw.index === primaryIndex,
    enabled: !raw.disabled,
    disabledReason: raw.disabled ? 'Button is disabled' : undefined,
    command: `bdg dom click ${raw.index}`,
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
  const primaryIndex = primaryButtonIndex(raw.buttons);
  const buttons = raw.buttons.map((button) => transformButton(button, primaryIndex));

  return {
    index: raw.index,
    name: raw.name,
    action: raw.action,
    method: raw.method,
    step: raw.step ?? undefined,
    relevanceScore: raw.relevanceScore,
    hidden: raw.hidden === true,
    inDialog: raw.inDialog === true,
    ...(raw.shadowHost && { shadowHost: raw.shadowHost }),
    fields,
    buttons,
    summary: calculateSummary(fields, buttons),
  };
}

/**
 * Cache form elements for index-based access.
 *
 * Each field and button is cached with its selector and backend node id, so
 * an index keeps addressing the same element even if other elements match
 * the selector later. The daemon binds the node ids during discovery; an
 * element it could not bind is resolved by its selector.
 *
 * @param forms - Discovered forms
 * @param rawForms - The same forms as the daemon found them (same order and indices), with node ids
 * @param document - Identity of the page document they were found in, read before discovery
 */
async function cacheFormElements(
  forms: DiscoveredForm[],
  rawForms: RawForm[],
  document: string | undefined
): Promise<void> {
  const elements = forms.flatMap((form) => [...form.fields, ...form.buttons]);
  const nodeIds = new Map(
    rawForms
      .flatMap((form) => [...form.fields, ...form.buttons])
      .map((el) => [el.index, el.backendNodeId])
  );
  const unbound = elements.filter((el) => nodeIds.get(el.index) === undefined);
  const resolved = await resolveBackendNodeIds(unbound.map((el) => el.selector)).catch(
    (error: unknown) => {
      log.debug(`Form fields not cached by node: ${getErrorMessage(error)}`);
      return [];
    }
  );
  unbound.forEach((el, i) => nodeIds.set(el.index, resolved[i]));

  await QueryCacheManager.getInstance().set(
    {
      selector: FORM_DISCOVERY_CACHE_SELECTOR,
      count: elements.length,
      nodes: elements.map((el) => ({
        index: el.index,
        nodeId: nodeIds.get(el.index) ?? 0,
        selector: el.selector,
      })),
    },
    document
  );

  log.debug(`Cached ${elements.length} form elements`);
}

/**
 * Handle form discovery command.
 *
 * @param options - Command options
 */
async function handleFormCommand(options: FormCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const document = await pageDocumentId();
      const response = await domFormDiscover();
      if (response.status === 'error' || !response.data) {
        return {
          success: false,
          error: response.error ?? 'Form discovery failed',
          exitCode: response.exitCode ?? EXIT_CODES.SOFTWARE_ERROR,
          ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
        };
      }
      const rawData = response.data;

      const frameForm = rawData.frameForms?.[0];
      if (rawData.forms.length === 0 && frameForm) {
        const err = formInIframeError(frameForm.url, false);
        return {
          success: false,
          error: err.message,
          exitCode: EXIT_CODES.FORM_IN_IFRAME,
          errorContext: { suggestion: err.suggestion },
        };
      }

      if (rawData.forms.length === 0) {
        const err = noFormsFoundError(rawData.readyState, rawData.closedShadowHosts);
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

      const orderedForms = orderForms(rawData.forms);
      const allForms = orderedForms.map(transformForm);
      const forms = options.all ? allForms : [allForms[0] as DiscoveredForm];

      // Cache ALL forms so global indices work with bdg dom fill/click
      await cacheFormElements(allForms, orderedForms, document);

      const result: FormDiscoveryResult = {
        formCount: rawData.forms.length,
        selectedForm: 0,
        forms,
        ...(!options.all && {
          otherForms: allForms.slice(1).map((form) => ({
            index: form.index,
            name: form.name,
            fieldCount: form.hidden
              ? form.fields.length
              : form.fields.filter((field) => !field.hidden).length,
            hidden: form.hidden,
            inDialog: form.inDialog,
            ...(form.shadowHost && { shadowHost: form.shadowHost }),
          })),
        }),
        ...(rawData.frameForms &&
          rawData.frameForms.length > 0 && {
            formsInFrames: rawData.frameForms.map((frame) => frame.url),
          }),
        ...(rawData.closedShadowHosts && { closedShadowHosts: rawData.closedShadowHosts }),
        ...(rawData.formIssues && { formIssues: rawData.formIssues }),
        brief: options.brief,
      };

      return { success: true, data: result };
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
