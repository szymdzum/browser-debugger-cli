/**
 * Protocol-owned DTOs for DOM command results.
 *
 * These interfaces describe the shape of data the worker returns over IPC.
 * Runtime implementations must produce values conforming to these shapes;
 * CLI commands and IPC transport consume them directly. Keeping the contract
 * here lets runtime and transport evolve independently.
 */

import type { FormStep, FieldOption } from '@/types.js';

/**
 * Result of filling an element.
 */
export interface FillResult {
  success: boolean;
  error?: string;
  selector?: string;
  value?: string;
  elementType?: string;
  inputType?: string | null;
  checked?: boolean;
  suggestion?: string;
}

/**
 * Result of clicking an element.
 */
export interface ClickResult {
  success: boolean;
  error?: string;
  selector?: string;
  elementType?: string;
  clickable?: boolean;
  matchCount?: number;
  selectedIndex?: number;
  requestedIndex?: number;
  suggestion?: string;
}

/**
 * Result of pressing a key on an element.
 */
export interface PressKeyResult {
  success: boolean;
  error?: string;
  selector?: string;
  key?: string;
  times?: number;
  modifiers?: number;
  elementType?: string | undefined;
  suggestion?: string;
}

/**
 * Result of a scroll operation.
 */
export interface ScrollResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  exitCode?: number;
  scrollType: 'element' | 'position' | 'offset';
  selector?: string;
  scrolledTo?: { x: number; y: number };
  scrolledBy?: { x: number; y: number };
  viewportSize?: { width: number; height: number };
  pageSize?: { width: number; height: number };
}

/**
 * Result of submitting a form.
 */
export interface SubmitResult {
  success: boolean;
  error?: string;
  selector?: string;
  clicked?: boolean;
  networkRequests?: number;
  navigationOccurred?: boolean;
  waitTimeMs?: number;
  suggestion?: string;
}

/**
 * Raw form data returned from the page-context form-discovery script.
 */
export interface RawFormData {
  forms: RawForm[];
}

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

export interface RawButton {
  index: number;
  selector: string;
  label: string;
  type: string;
  disabled: boolean;
  isPrimary: boolean;
}
