/**
 * Protocol-owned DTOs for DOM command results.
 *
 * These interfaces describe the shape of data the daemon returns over IPC.
 * Runtime implementations must produce values conforming to these shapes;
 * CLI commands and IPC transport consume them directly. Keeping the contract
 * here lets runtime and transport evolve independently.
 */

import type { FormStep, FieldOption, ViewportPosition } from '@/types.js';

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
 * A network request that started while a command ran (after the action began
 * and before the command returned).
 */
export interface TriggeredRequest {
  /** Request id (what `bdg details network <id>` takes) */
  requestId: string;
  method: string;
  url: string;
  /** HTTP status, once a response arrived */
  status?: number;
  /** How long it took, once it finished or failed */
  durationMs?: number;
  /** Set when it failed without a response (DNS, refused, aborted, blocked) */
  failed?: true;
  /** Why it failed (also set when loading failed after the response) */
  errorText?: string;
  /** Set when it was still running when the command returned */
  pending?: true;
  /**
   * Set when the response arrived but its body was still loading when the
   * command returned (a stream such as EventSource, a slow download)
   */
  loading?: true;
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
  /** Requests the action triggered (absent when network telemetry is off) */
  triggeredRequests?: TriggeredRequest[];
  /** Requests left out of `triggeredRequests` (it lists the first 50) */
  triggeredRequestsOmitted?: number;
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
  /** Requests the action triggered (absent when network telemetry is off) */
  triggeredRequests?: TriggeredRequest[];
  /** Requests left out of `triggeredRequests` (it lists the first 50) */
  triggeredRequestsOmitted?: number;
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
  /** Requests the action triggered (absent when network telemetry is off) */
  triggeredRequests?: TriggeredRequest[];
  /** Requests left out of `triggeredRequests` (it lists the first 50) */
  triggeredRequestsOmitted?: number;
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
  /** Requests the action triggered (absent when network telemetry is off) */
  triggeredRequests?: TriggeredRequest[];
  /** Requests left out of `triggeredRequests` (it lists the first 50) */
  triggeredRequestsOmitted?: number;
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
  /** Requests the action triggered (absent when network telemetry is off) */
  triggeredRequests?: TriggeredRequest[];
  /** Requests left out of `triggeredRequests` (it lists the first 50) */
  triggeredRequestsOmitted?: number;
}

/** Where an event listener is attached, seen from the inspected element. */
export type ListenerPlacement = 'target' | 'ancestor' | 'document' | 'window';

/** The function an event listener calls. */
export interface ListenerHandler {
  /** Function name (`Function.name`; empty when anonymous) */
  name: string;
  /** Start of the function source, on one line */
  preview: string;
  /** Script that defines the handler (CDP script id) */
  scriptId: string;
  /** 0-based line in the script */
  lineNumber: number;
  /** 0-based column in the script */
  columnNumber: number;
}

/** An event listener that runs for events on the inspected element. */
export interface ElementListener {
  /** Event type, e.g. `click` */
  type: string;
  /** Where the listener is attached */
  on: ListenerPlacement;
  /** The node or object it is attached to, e.g. `div#root.app` */
  node: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  handler: ListenerHandler;
}

/**
 * Event listeners of an element, its ancestors, its document and window,
 * grouped by event type, nearest first.
 */
export interface ListenersResult {
  /** Always true: failures are reported as errors */
  success: true;
  /** Selector the element was found with */
  selector?: string;
  /** Index among the selector's matches (or in the cached query) */
  index?: number;
  /** The inspected element, e.g. `button#save` */
  element: string;
  listeners: ElementListener[];
  /** Elements the selector matched */
  matchCount?: number;
  /** Set when several elements matched and no --index was given */
  warning?: string;
}

/** A point in CSS pixels. */
export interface LayoutPoint {
  x: number;
  y: number;
}

/** A width and height in CSS pixels. */
export interface LayoutSize {
  width: number;
  height: number;
}

/** Position and size of an element's border box in CSS pixels. */
export type LayoutBox = LayoutPoint & LayoutSize;

/** Computed styles that decide whether and how an element shows. */
export interface LayoutComputedStyle {
  display: string;
  visibility: string;
  position: string;
  opacity: string;
  zIndex: string;
}

/** Where one element is on the page and whether a user can see it. */
export interface ElementLayout {
  /** Index among the selector's matches (or in the cached query) */
  index: number;
  tag: string;
  /** Short description, e.g. `button#save.primary` */
  element: string;
  /** Text preview */
  text?: string;
  /** Enclosing iframe(s) and shadow root, e.g. `iframe#pay > shadow root of <x-card>` */
  context?: string;
  /** Border box relative to the top-level document (page coordinates) */
  bounds: LayoutBox;
  /** Top-left corner relative to the top-level viewport */
  viewport: LayoutPoint;
  inViewport: ViewportPosition;
  /** Share of the element in view, for `partly` */
  percentVisible?: number;
  /** Why it is `hidden`, e.g. `display: none` */
  hiddenReason?: string;
  /** Page scroll (`window.scrollBy`) that brings it fully into view, when one helps */
  scrollBy?: LayoutPoint;
  /** Ancestor or iframe cutting it off (scroll that container instead of the page) */
  clippedBy?: string;
  /** Topmost element at the center of its visible part, when that is another element */
  coveredBy?: string;
  /** Inside an `inert` element: shown, but a user cannot interact with it */
  inert?: true;
  computed: LayoutComputedStyle;
}

/** Viewport, scroll position and document size of the top-level page. */
export interface PageLayout {
  viewport: LayoutSize;
  scroll: LayoutPoint;
  document: LayoutSize;
}

/** Layout of the elements a selector (or cached index) refers to. */
export interface LayoutResult {
  /** Always true: failures are reported as errors */
  success: true;
  /** Selector the elements were found with (for an index: the cached query's) */
  selector: string;
  /** Elements the selector matched (1 for an index) */
  count: number;
  page: PageLayout;
  elements: ElementLayout[];
  /** Matches left out of `elements` (beyond the limit) */
  omitted?: number;
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
