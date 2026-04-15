/**
 * Type definitions for form discovery command.
 *
 * Re-exports shared types from types.js and defines command-specific types.
 */

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

export type { RawFormData, RawForm, RawField, RawButton } from '@/ipc/protocol/domTypes.js';
