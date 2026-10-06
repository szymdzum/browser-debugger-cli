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
  /** CDP resource type, e.g. `Document`, `Fetch`, `Stylesheet` */
  resourceType?: string;
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

/** How the page changed location during an action */
export interface PageNavigation {
  /** URL the page shows after the action */
  url: string;
  /** True for a same-document change (history API, hash); false for a new document */
  sameDocument: boolean;
  /** HTTP status of the new document, when known */
  status?: number;
}

/** A message (alert, status, flash, error text) the page showed during an action */
export interface NewMessage {
  /** Its visible text (close buttons and aria-hidden parts left out), at most 120 characters */
  text: string;
  /** The element showing it, e.g. `div#flash.flash.error` */
  element: string;
}

/** An element a hover or key press showed (added, or made visible) */
export interface ShownElement {
  /** Its visible text, at most 120 characters */
  text: string;
  /** The element, e.g. `div.figcaption` */
  element: string;
}

/** What the page was still working on when an action returned */
export interface PendingChanges {
  /** Content requests (documents, fetch/XHR, scripts) the action started that were still running */
  requests?: number;
  /** A new document was still loading */
  navigation?: true;
  /** A loading indicator that appeared during the action and was still shown, e.g. `div#loading` */
  loading?: string;
  /** The DOM was still changing (several bursts of changes, the last one under 150 ms ago) */
  domChanging?: true;
  /** The page did not answer within 250 ms (a long-running script) */
  busy?: true;
}

/** What an action changed on the page, besides its triggered requests */
export interface ActionEffects {
  /** The page navigated or changed its URL (absent when it did not) */
  navigation?: PageNavigation;
  /** Messages that appeared or changed (at most 3; absent when none did) */
  messages?: NewMessage[];
  /** Elements a hover or key press showed (at most 3, outermost first; absent when none) */
  shown?: ShownElement[];
  /** "none" when the action had no visible effect: no DOM change, request or navigation */
  effect?: 'none';
  /** False when the page was still changing as the action returned (absent otherwise) */
  settled?: false;
  /** What the page was still working on (with `settled: false`) */
  pending?: PendingChanges;
}

/** A filled field's value differing from the one given */
export interface FillValueMismatch {
  /** Value given (for a select: the chosen option's value; checkboxes: checked/unchecked) */
  expected: string;
  /** Value the field has after filling */
  actual: string;
  /** Set when the page cut the value to the field's maxlength */
  truncatedTo?: number;
  /** Password fields (values masked): length of the value given */
  expectedLength?: number;
  /** Password fields (values masked): length of the field's value */
  actualLength?: number;
  /** Another field of the form that holds the value given, e.g. `input#first-name` */
  movedTo?: string;
}

/**
 * Result of filling an element.
 */
export interface FillResult extends ActionEffects {
  success: boolean;
  error?: string;
  selector?: string;
  value?: string;
  /** The element acted on, e.g. `input.toggle in div.view "Write report"` */
  element?: string;
  elementType?: string;
  inputType?: string | null;
  checked?: boolean;
  /**
   * Set when the field's value read back after filling is not the one given
   * (the page rejected, reformatted or moved it; passwords masked)
   */
  valueMismatch?: FillValueMismatch;
  suggestion?: string;
  /** Set when the target is a file input (filled through CDP instead) */
  fileInput?: boolean;
  /** Set when the target is not a field (nor a label of one): a list from another command was likely meant */
  unsuitableElement?: boolean;
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
export interface ClickResult extends ActionEffects {
  success: boolean;
  error?: string;
  selector?: string;
  /** The element acted on, e.g. `input.toggle in div.view "Write report"` */
  element?: string;
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
export interface PressKeyResult extends ActionEffects {
  success: boolean;
  error?: string;
  selector?: string;
  /** The element acted on, e.g. `input.toggle in div.view "Write report"` */
  element?: string;
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
export interface ScrollResult extends ActionEffects {
  success: boolean;
  error?: string;
  suggestion?: string;
  exitCode?: number;
  scrollType: 'element' | 'position' | 'offset';
  selector?: string;
  /** The element acted on, e.g. `input.toggle in div.view "Write report"` */
  element?: string;
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
export interface SubmitResult extends ActionEffects {
  success: boolean;
  error?: string;
  selector?: string;
  /** The element acted on, e.g. `input.toggle in div.view "Write report"` */
  element?: string;
  clicked?: boolean;
  /** Set when the target is neither a form nor a button: a list from another command was likely meant */
  unsuitableElement?: boolean;
  networkRequests?: number;
  navigationOccurred?: boolean;
  waitTimeMs?: number;
  /** Set when the page loaded but its requests had not finished by the timeout */
  warning?: string;
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
  /** The handler does nothing (an empty function, like React's `onclick` placeholder) */
  noop?: true;
  /**
   * Registered through this framework; `handler` is the real handler, not
   * the framework's dispatcher. React handlers are `on…` props of the node
   * (`reactProp`), run by React's dispatchers on its root container;
   * Preact handlers are run by Preact's event proxy on the node itself.
   */
  framework?: 'jQuery' | 'Preact' | 'React';
  /** React prop the handler is set as, e.g. `onClick`, `onClickCapture` */
  reactProp?: string;
  /** jQuery delegate selector (`.on(type, selector, fn)`) the element matched */
  delegateSelector?: string;
}

/**
 * Listeners of one node collapsed into a summary: a framework root (React's
 * root container) registers the same few dispatchers for dozens of event types.
 */
export interface CollapsedListeners {
  /** Where the listeners are attached */
  on: ListenerPlacement;
  /** The node or object they are attached to, e.g. `div#__next` */
  node: string;
  /** Framework recognised on the node, e.g. `React root` */
  framework?: string;
  /** Event types, alphabetically */
  types: string[];
  /** Number of listeners collapsed */
  count: number;
  /** Some listen in the capture phase */
  capture: boolean;
  /** Some listen in the bubble phase */
  bubble: boolean;
  /** The distinct dispatcher functions */
  handlers: ListenerHandler[];
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
  /** Framework root listeners, one entry per node (missing with `all`) */
  collapsed?: CollapsedListeners[];
  /** The iframe element whose document holds the element, e.g. `iframe#checkout` */
  frame?: string;
  /** jQuery handlers not resolved (over 50 per call): their dispatcher is listed instead */
  jqueryHandlersSkipped?: number;
  /** React `on…` props not resolved (over 50 per call) */
  reactHandlersSkipped?: number;
  /** Event types with listeners close to the requested ones, when none matched (`Click` → `click`) */
  typeSuggestions?: string[];
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
  /**
   * Page scroll (`window.scrollBy`) that shows all of it, when the page can
   * scroll there: for a `partly` visible element the smallest such scroll (the
   * part cut off at the edge; the start of one larger than the viewport), for
   * one out of view the scroll centring it (as `dom scroll <selector>` does)
   */
  scrollBy?: LayoutPoint;
  /** Ancestor or iframe cutting it off (scroll that container instead of the page) */
  clippedBy?: string;
  /** Why page scroll cannot bring it fully into view: it is fixed, or beyond the page's scroll range */
  offScreenReason?: string;
  /** Topmost element at the center of its visible part, when that is another element */
  coveredBy?: string;
  /**
   * The covering element paints nothing at that point (no background, image,
   * shadow or text of its own): the element still shows, but clicks land on
   * the cover
   */
  coverTransparent?: true;
  /**
   * Why it cannot be seen although it is rendered: `opacity: 0` on it or an
   * ancestor, or a `clip-path`/`clip` that cuts it away entirely, e.g.
   * `opacity: 0 on div#menu` (`inViewport` still says where it is)
   */
  invisible?: string;
  /** Inside an `inert` element: shown, but a user cannot interact with it */
  inert?: true;
  computed: LayoutComputedStyle;
}

/** Viewport, scroll position and document size of the top-level page. */
export interface PageLayout {
  /** Layout viewport without scrollbars (as `dom scroll` reports it) */
  viewport: LayoutSize;
  scroll: LayoutPoint;
  document: LayoutSize;
  /** `prefers-color-scheme` the page sees (the system's unless `--color-scheme` was given at start) */
  colorScheme?: 'light' | 'dark';
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
  /** The page's `document.readyState` when the forms were read */
  readyState?: string;
}

export interface RawForm {
  index: number;
  name: string | null;
  action: string | null;
  method: string;
  step: FormStep | null;
  relevanceScore: number;
  /** Not rendered (or visibility-hidden), or all its fields are */
  hidden?: boolean;
  /** Shown inside an open dialog (`dialog[open]`, `aria-modal`, a dialog role) */
  inDialog?: boolean;
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
  /** `required`, aria-required, or a label marked with an asterisk */
  required: boolean;
  /** Name of the radio/checkbox group (legend, radiogroup label or name) */
  groupLabel?: string;
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
  /** A submit button by markup: `<input type=submit>` or `type="submit"` written out */
  explicitSubmit: boolean;
  /** A `<button>` without a type in a form: submits it, like Enter does */
  formDefault: boolean;
  /** Has a class like `primary`, `btn-primary` or `submit` */
  primaryClass: boolean;
}
