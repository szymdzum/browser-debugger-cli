/**
 * Protocol-owned DTOs for DOM command results.
 *
 * These interfaces describe the shape of data the daemon returns over IPC.
 * Runtime implementations must produce values conforming to these shapes;
 * CLI commands and IPC transport consume them directly. Keeping the contract
 * here lets runtime and transport evolve independently.
 */

import type { FormStep, FieldOption } from '@/types.js';

/**
 * A JavaScript dialog (alert, confirm, prompt, beforeunload) that bdg accepted
 * while a command ran.
 */
export interface DialogInfo {
  /** Dialog type: alert, confirm, prompt or beforeunload */
  type: string;
  /** Text the page showed */
  message: string;
}

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
  /** Set when the target is a file input (filled through CDP instead) */
  fileInput?: boolean;
  /** Something the page will likely object to (e.g. a value above max) */
  warning?: string;
  /** Elements the selector matched */
  matchCount?: number;
  exitCode?: number;
  /** Dialogs accepted while the command ran */
  dialogs?: DialogInfo[];
}

/**
 * Result of clicking an element.
 */
export interface ClickResult {
  success: boolean;
  error?: string;
  selector?: string;
  elementType?: string;
  matchCount?: number;
  selectedIndex?: number;
  requestedIndex?: number;
  suggestion?: string;
  /** How the click was performed: real mouse events, or el.click() fallback */
  method?: 'mouse' | 'dom';
  /** What was done: click, double (click), right (click) or hover */
  action?: 'click' | 'double' | 'right' | 'hover';
  /** Exit code for a failure */
  exitCode?: number;
  /** Why the DOM fallback was used (element covered or without size) */
  warning?: string;
  /** Dialogs accepted while the command ran */
  dialogs?: DialogInfo[];
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
  /** Modifier keys held, e.g. ["Ctrl", "Shift"] */
  modifiers?: string[];
  elementType?: string | undefined;
  suggestion?: string;
  exitCode?: number;
  /** Elements the selector matched */
  matchCount?: number;
  /** Set when the selector matched several elements */
  warning?: string;
  /** Dialogs accepted while the command ran */
  dialogs?: DialogInfo[];
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
  /** Elements the selector matched */
  matchCount?: number;
  /** Set when the selector matched several elements */
  warning?: string;
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
  exitCode?: number;
  /** Dialogs accepted while the command ran */
  dialogs?: DialogInfo[];
}

/**
 * Raw form data returned from the page-context form-discovery script.
 */
export interface RawFormData {
  forms: RawForm[];
  /** Same-origin iframes holding form fields, when the main document has none */
  frameForms?: Array<{ url: string }>;
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
  /** Only the "required but empty" constraint fails */
  valueMissing?: boolean;
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
