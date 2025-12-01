/**
 * Type definitions for form discovery command.
 *
 * Re-exports shared types from types.js and defines command-specific types.
 */

import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import type { FormStep, FieldOption } from '@/types.js';

// Re-export shared types for convenience
export type {
  FieldValidation,
  FieldOption,
  FormFieldType,
  FieldState,
  FormField,
  FormButton,
  FormBlocker,
  FormSummary,
  FormStep,
  DiscoveredForm,
  FormDiscoveryResult,
} from '@/types.js';

/**
 * Command options for form discovery.
 */
export interface FormCommandOptions extends BaseOptions {
  all?: boolean;
  brief?: boolean;
}

/**
 * Raw form data returned from page-context script.
 */
export interface RawFormData {
  forms: RawForm[];
}

/**
 * Raw form structure from page-context script.
 */
export interface RawForm {
  index: number;
  name: string | null;
  action: string | null;
  method: string;
  step: FormStep | null;
  relevanceScore: number;
  inIframe: boolean;
  iframeUrl?: string;
  crossOrigin?: boolean;
  fields: RawField[];
  buttons: RawButton[];
}

/**
 * Raw field data from page-context script.
 */
export interface RawField {
  index: number;
  formIndex: number;
  selector: string;
  type: string;
  inputType?: string;
  label: string;
  name: string | null;
  placeholder?: string;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  hidden: boolean;
  native: boolean;
  value: string | boolean | string[];
  checked?: boolean;
  validationMessage?: string;
  isValid: boolean;
  ariaInvalid?: boolean;
  hasErrorClass?: boolean;
  siblingErrorText?: string;
  options?: FieldOption[];
}

/**
 * Raw button data from page-context script.
 */
export interface RawButton {
  index: number;
  selector: string;
  label: string;
  type: string;
  disabled: boolean;
  isPrimary: boolean;
}
