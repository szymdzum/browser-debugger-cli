import type { Protocol } from '@/connection/typed-cdp.js';
import type { DownloadInfo, FormIssue } from '@/ipc/protocol/domTypes.js';

/**
 * Standard response envelope for all bdg command JSON output.
 *
 * **STABILITY: This is a stable API contract.**
 *
 * All commands returning JSON MUST use this envelope structure.
 * Breaking changes require a major version bump.
 *
 * @example Success response
 * ```json
 * {
 *   "version": "0.6.8",
 *   "success": true,
 *   "data": { "count": 10, "items": [...] }
 * }
 * ```
 *
 * @example Error response
 * ```json
 * {
 *   "version": "0.6.8",
 *   "success": false,
 *   "error": "Session not found",
 *   "exitCode": 83,
 *   "suggestion": "Start a session with: bdg <url>"
 * }
 * ```
 */
export interface BdgResponse<T = unknown> {
  /** Tool version for schema compatibility checking */
  version: string;

  /** Whether the command succeeded */
  success: boolean;

  /** Response data (present when success=true) */
  data?: T;

  /** Error message (present when success=false) */
  error?: string;

  /** Semantic exit code (present when success=false) */
  exitCode?: number;

  /** Actionable suggestion for error recovery */
  suggestion?: string;

  /** How the command ran despite something unusual (e.g. a CDP method bdg's protocol lacks) */
  warning?: string;
}

/**
 * Re-export connection types for backward compatibility.
 *
 * These types are now defined in connection/connectionTypes.ts for better cohesion.
 * This re-export maintains backward compatibility with existing code.
 */
export type {
  CDPMessage,
  CDPTarget,
  ConnectionOptions,
  LaunchedChrome,
  Logger,
  CleanupFunction,
} from '@/connection/types.js';

/**
 * WebSocket frame data captured during connection.
 */
export interface WebSocketFrame {
  /** Timestamp when frame was sent/received */
  timestamp: number;
  /** Direction: 'sent' or 'received' */
  direction: 'sent' | 'received';
  /** WebSocket opcode (1 = text, 2 = binary) */
  opcode: number;
  /** Frame payload data (base64 for binary frames) */
  payloadData: string;
  /** Original payload length in characters, when `payloadData` was truncated */
  truncatedFrom?: number;
}

/**
 * WebSocket connection with lifecycle and frame data.
 */
export interface WebSocketConnection {
  /** Request ID from CDP */
  requestId: string;
  /** WebSocket URL */
  url: string;
  /** Timestamp when connection was created */
  timestamp: number;
  /** Initiator URL (page that opened the WebSocket) */
  initiatorUrl?: string;
  /** Request headers of the handshake */
  requestHeaders?: Record<string, string>;
  /** Response status from handshake */
  status?: number;
  /** Response status text from handshake */
  statusText?: string;
  /** Response headers from handshake */
  responseHeaders?: Record<string, string>;
  /** Captured frames (sent and received) */
  frames: WebSocketFrame[];
  /** Timestamp when connection was closed */
  closedTime?: number;
  /** Error message if connection failed */
  errorMessage?: string;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  /**
   * CDP resource type classification (Document, XHR, Script, Image, etc.)
   * Enables filtering and identification of request types.
   * Captured from Network.requestWillBeSent and Network.responseReceived events.
   */
  resourceType?: Protocol.Network.ResourceType;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  navigationId?: number;
  timing?: {
    requestTime?: number;
    proxyStart?: number;
    proxyEnd?: number;
    dnsStart?: number;
    dnsEnd?: number;
    connectStart?: number;
    connectEnd?: number;
    sslStart?: number;
    sslEnd?: number;
    workerStart?: number;
    workerReady?: number;
    workerFetchStart?: number;
    workerRespondWithSettled?: number;
    sendStart?: number;
    sendEnd?: number;
    pushStart?: number;
    pushEnd?: number;
    receiveHeadersEnd?: number;
  };
  loadingFinishedTime?: number;
  /** Chrome's monotonic time (seconds) when the request was sent; durations are measured from it */
  sentTime?: number;
  /** Milliseconds from the request start to its last byte or failure (a redirect hop: to the redirect) */
  duration?: number;
  /** For a redirect hop: the URL it redirected to */
  redirectURL?: string;
  encodedDataLength?: number;
  decodedBodyLength?: number;
  /** Address Chrome connected to: the server's, or a proxy's (CDP `remoteIPAddress`) */
  serverIPAddress?: string;
  /** Port Chrome connected to (CDP `remotePort`) */
  serverPort?: number;
  connection?: string;
  /** Status text sent by the server (empty for HTTP/2) */
  statusText?: string;
  /** `responseBody` is base64 (binary content) */
  responseBodyBase64?: boolean;
  /** Served from the browser's memory, disk or prefetch cache */
  fromCache?: boolean;
  /** Why the response body was not captured (`details`; `responseBody` is then absent) */
  bodyNotCaptured?: string;
  /** Why the request body was not kept (`details`; `requestBody` is then absent) */
  requestBodyNotCaptured?: string;
  /** Messages and lifecycle of a WebSocket connection (`resourceType` is `WebSocket`) */
  webSocket?: {
    frames: WebSocketFrame[];
    closedTime?: number;
  };
  /**
   * Network error text from loadingFailed events.
   * Contains specific error codes like net::ERR_CERT_DATE_INVALID, net::ERR_CONNECTION_REFUSED.
   */
  errorText?: string;
  /**
   * Whether the request was canceled (e.g., navigation away, fetch abort).
   */
  canceled?: boolean;
  /**
   * Whether the request was blocked (e.g., CORS, mixed content).
   */
  blocked?: boolean;
  /**
   * Reason for blocking (e.g., 'cors', 'mixed-content', 'inspector').
   */
  blockedReason?: string;
}

/**
 * Stack frame representing a location in source code.
 * Used for error stack traces and source locations in console messages.
 */
export interface StackFrame {
  /** Source file URL or path */
  url: string;
  /** 0-based line number in the source */
  lineNumber: number;
  /** 0-based column number in the source */
  columnNumber: number;
  /** Function name, if available */
  functionName?: string;
  /** Script ID from CDP */
  scriptId?: string;
}

export interface ConsoleMessage {
  /** Position in the session's message list (set in previews; `details console <n>` takes it) */
  index?: number;
  type: Protocol.Runtime.ConsoleAPICalledEvent['type'];
  text: string;
  timestamp: number;
  args?: unknown[];
  navigationId?: number;
  /**
   * Stack trace captured when the console call was made.
   * First frame indicates the source location of the console call.
   */
  stackTrace?: StackFrame[];
  /** Browser subsystem of a browser message (`network`, `security`, ...); absent for page console calls */
  source?: Protocol.Log.LogEntry['source'];
  /** Original length of `text` when JSON output cut it (`--full` keeps it whole) */
  truncatedFrom?: number;
}

/**
 * A Chrome Issue (DevTools Issues panel) of the page currently loaded: one of
 * the kinds that make a page look or behave wrong without a console message.
 */
export interface PageIssue {
  /** Chrome's issue code, e.g. `QuirksModeIssue`, `GenericIssue` */
  code: string;
  /** Kind within the code, e.g. `FormDuplicateIdForInputError`, `kEvalViolation` */
  type?: string;
  /** One-line reason */
  text: string;
  /** Elements at fault (the first ones; `count` has how many there are) */
  nodes?: IssueNode[];
  /** Number of elements at fault (Chrome reports each; bdg lists the kind once) */
  count?: number;
  /** The document, or the stylesheet or script position (1-based line and column) */
  source?: { url: string; line?: number; column?: number };
}

/** An element a Chrome Issue is about */
export interface IssueNode {
  /** Backend node id (e.g. for `DOM.resolveNode`) */
  backendNodeId: number;
  /** e.g. `label[for="missing"]`, `input#email` (set shortly after the issue arrives) */
  description?: string;
}

/**
 * Console message level categories for user-facing filtering.
 * Used by --level option in console command.
 */
export type ConsoleLevel = 'error' | 'warning' | 'info' | 'debug';

export interface BdgOutput {
  version: string; // Package version for schema tracking
  success: boolean;
  timestamp: string;
  duration: number;
  target: {
    url: string;
    title: string;
  };
  data: {
    network?: NetworkRequest[];
    console?: ConsoleMessage[];
    websockets?: WebSocketConnection[];
    /** Chrome Issues of the page currently loaded */
    issues?: PageIssue[];
  };
  /** Navigation id of the page currently loaded (live previews) */
  currentNavigationId?: number;
  /** When the page's renderer crashed (epoch ms), while it is not loaded again */
  pageCrashedAt?: number;
  /** Downloads that began during the session, oldest first (live previews) */
  downloads?: DownloadInfo[];
  /** Counts of all captured items matching the request (e.g. `peek --type`), when `data` holds only the most recent ones */
  totals?: {
    network: number;
    console: number;
    /** Console messages dropped at the limit, oldest first (indices start after them) */
    consoleDropped?: number;
    /** Finished network requests dropped at the request cap, oldest first */
    networkDropped?: number;
    /** Response bodies evicted at the total body budget, oldest first */
    networkBodiesEvicted?: number;
    /** Chrome Issues of the page currently loaded */
    issues?: number;
    /** Chrome Issues of the page not kept past the per-page limit */
    issuesDropped?: number;
  };
  error?: string;
  partial?: boolean; // Flag to indicate this is partial/incomplete data (live preview)
}

export type TelemetryType = 'dom' | 'network' | 'console';

/**
 * Accessibility tree node with filtered and formatted data.
 *
 * This is a simplified representation of Protocol.Accessibility.AXNode
 * optimized for agent consumption and semantic queries.
 */
export interface A11yNode {
  /** Position in the last `a11y query` result (usable as a DOM index, e.g. `bdg dom click 0`) */
  index?: number;
  /** Unique node identifier from CDP */
  nodeId: string;
  /** ARIA role (button, textbox, heading, etc.) */
  role: string;
  /** Accessible name (computed label) */
  name?: string;
  /** Accessible description */
  description?: string;
  /** Node value (for inputs, textareas, etc.) */
  value?: string;
  /** Whether node is focusable */
  focusable?: boolean;
  /** Whether node is currently focused */
  focused?: boolean;
  /** Whether node is disabled */
  disabled?: boolean;
  /** Whether field is required (forms) */
  required?: boolean;
  /** Additional ARIA properties */
  properties?: Record<string, unknown>;
  /** Child node IDs */
  childIds?: string[];
  /** Associated DOM node ID for querying */
  backendDOMNodeId?: number;
  /** True when node is synthesized from DOM context (a11y unavailable) */
  inferred?: boolean;
}

/**
 * Accessibility tree data structure.
 */
export interface A11yTree {
  /** Root node of the tree */
  root: A11yNode;
  /** All nodes indexed by nodeId for fast lookup */
  nodes: Map<string, A11yNode>;
  /** Total node count */
  count: number;
}

/** An accessibility node as `dom a11y tree` lists it */
export type ListedA11yNode = Omit<A11yNode, 'childIds'> & {
  /** Indentation level (0 = root; left-out wrappers add none) */
  depth: number;
};

/**
 * The part of an accessibility tree `dom a11y tree` lists (`--limit`, `--depth`).
 */
export interface ListedA11yTree {
  /** Listed nodes, depth-first from the root */
  nodes: ListedA11yNode[];
  /** Nodes in the whole tree (listed + omitted + skipped) */
  count: number;
  /** Nodes left out by `--limit` or `--depth` */
  omitted?: number;
  /** Nodes never listed: text boxes, blank or repeated text, nameless layout wrappers */
  skipped?: number;
}

/**
 * Query pattern for searching accessibility tree.
 *
 * @example
 * ```typescript
 * { role: 'button', name: 'Submit' }
 * { role: 'textbox' }
 * { name: 'Email' }
 * ```
 */
export interface A11yQueryPattern {
  /** Filter by ARIA role */
  role?: string;
  /** Filter by accessible name (case-insensitive) */
  name?: string;
  /** Filter by accessible description (case-insensitive) */
  description?: string;
}

/**
 * Result from A11y query operation.
 */
export interface A11yQueryResult {
  /** Matching nodes (the first `--limit` of them) */
  nodes: A11yNode[];
  /** Total matches found */
  count: number;
  /** Matches not listed because of `--limit` (their indices still work) */
  omitted?: number;
  /** Query pattern used */
  pattern: A11yQueryPattern;
}

/**
 * DOM context information for enriching semantic output.
 * Used when a11y name is missing to provide useful element context.
 */
export interface DomContext {
  tag: string;
  classes?: string[];
  preview?: string;
  /** Up to 500 characters of text, when it is longer than the preview */
  text?: string;
  /** First child elements (`tag#id.class`), for an element without text */
  children?: string[];
  /** Number of child elements, for an element without text */
  childCount?: number;
  /** The children listed are those of its shadow root (a web component) */
  shadowChildren?: boolean;
  /** Attributes that identify it by its type (see {@link KeyAttributes}) */
  attributes?: KeyAttributes;
  /** A field holding a secret (password, card, one-time code): its value is shown masked */
  sensitive?: boolean;
}

/**
 * Live state of a form control read in the page: an input's type and value
 * (`checked` for checkboxes and radios), a textarea's value, the labels of a
 * select's selected options, the type of a button in a form.
 */
export interface ElementState {
  type?: string;
  /** Masked in the page for sensitive fields; never read for hidden inputs */
  value?: string;
  checked?: boolean;
  selected?: string;
  /** A field holding a secret (its value and selected option are masked) */
  sensitive?: boolean;
}

/**
 * The attributes that identify an element by its type, with full values:
 * img `src`, `alt`; a `href`; input `type`, `name`, `placeholder`, `value`
 * (current value, masked for passwords; for checkboxes and radios their
 * `value` attribute) and `checked`; textarea `name`,
 * `placeholder`, `value`; button `type` (`submit` by default in a form), `name`; select `name`, `selected`
 * (labels of the selected options); iframe `src`; form `action`, `method`.
 */
export type KeyAttributes = Record<string, string | boolean>;

/**
 * Reference to a DOM node for CDP calls: a per-connection `nodeId` (valid only
 * within one command) or a `backendNodeId` (valid while the node exists).
 */
export type NodeRef = { nodeId: number } | { backendNodeId: number };

/** `prefers-color-scheme` value a session emulates (`--color-scheme`) */
export type ColorScheme = 'light' | 'dark';

/** Viewport size in CSS px (`--viewport`) */
export interface ViewportSize {
  width: number;
  height: number;
  /** A phone: mobile viewport (meta viewport, overlay scrollbars), touch and a mobile user agent */
  mobile?: true;
}

/**
 * The page (document) request an action sent, as far as it got: still
 * pending, answered with a status, or failed.
 */
export interface DocumentRequestState {
  method: string;
  url: string;
  /** How long it has been running (pending requests) */
  pendingMs?: number;
  /** HTTP status of the response, once answered */
  status?: number;
  statusText?: string;
  /** Network error, when it failed */
  errorText?: string;
}

/**
 * The list a numeric index refers to: the results of the last
 * `bdg dom query`, `bdg dom form` or `bdg dom a11y query` (one cache holds
 * the last of them).
 */
export interface IndexSource {
  /** The index the user gave (0-based) */
  index: number;
  /** Command whose results are cached */
  command: 'dom query' | 'dom form' | 'dom a11y query';
  /** The query's selector or a11y pattern (not for `dom form`) */
  query?: string;
}

/**
 * Where an element is relative to the top-level viewport: fully `visible`,
 * `partly` visible, outside it in one direction, or `hidden` (not rendered,
 * `visibility: hidden`, zero size, inert, or clipped away).
 */
export type ViewportPosition =
  'visible' | 'partly' | 'above' | 'below' | 'left' | 'right' | 'hidden';

/**
 * Result of a DOM query operation.
 */
export interface DomQueryResult {
  selector: string;
  count: number;
  nodes: Array<{
    index: number;
    /** Backend node id (stable while the element exists; 0 if unknown) */
    nodeId: number;
    tag?: string;
    /** `id`, `name` and `type` attributes, when present */
    id?: string;
    name?: string;
    type?: string;
    /** `value` attribute of an `<option>` */
    value?: string;
    /** Attributes that identify it by its type (see {@link KeyAttributes}) */
    attributes?: KeyAttributes;
    classes?: string[];
    /** Text content preview (display only, never used for targeting) */
    preview?: string;
    /** Enclosing iframe(s) and shadow root, e.g. "iframe#pay > shadow root of <x-card>" */
    context?: string;
    /** Where the element is relative to the viewport when queried (first 100 matches) */
    inViewport?: ViewportPosition;
    /** Ancestor or iframe cutting it off, e.g. a scrolled list */
    clippedBy?: string;
    /** Unique selector for this node (set by form discovery) */
    selector?: string;
  }>;
  /** Matches not listed (`--limit`); `count` is all of them */
  omitted?: number;
  /** Matches usable by index (described and cached), when fewer than `count` */
  indexed?: number;
  /** First matches whose viewport position was checked (`inViewport`), when more are listed */
  viewportChecked?: number;
  /** Identity of the page document the matches belong to (cached results only) */
  document?: string;
}

/**
 * Result of a DOM get operation.
 */
export interface DomGetResult {
  nodes: Array<{
    nodeId: number;
    tag?: string;
    attributes?: Record<string, unknown>;
    classes?: string[];
    outerHTML?: string;
    /** Original length of `outerHTML` when JSON output cut it (`--full` keeps it whole) */
    truncatedFrom?: number;
  }>;
}

/**
 * Element bounding box coordinates.
 */
export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result of a screenshot operation.
 */
export interface ScreenshotResult {
  path: string;
  format: 'png' | 'jpeg';
  quality?: number;
  width: number;
  height: number;
  size: number;
  viewport?: {
    width: number;
    height: number;
  };
  fullPage: boolean;
  element?: {
    selector?: string;
    index?: number;
    /** Border box of the element (page coordinates for element captures) */
    bounds: ElementBounds;
    /**
     * Area captured, when content overflowing the element (floats, positioned
     * descendants) made it larger than the border box
     */
    captured?: ElementBounds;
    /** `--padding` given: CSS px of page added around the captured area */
    padding?: number;
  };
  /** Capture mode used: the whole page, the viewport, or one element */
  captureMode?: 'full_page' | 'viewport' | 'element';
  /** Whether the image was auto-resized to fit token budget */
  resized?: boolean;
  /** Original width before resize (pixels) */
  originalWidth?: number;
  /** Original height before resize (pixels) */
  originalHeight?: number;
  /** Estimated tokens at original size */
  originalTokens?: number;
  /** Estimated tokens at final size */
  finalTokens?: number;
  /** Present when full page was requested but skipped */
  fullPageSkipped?: {
    reason: 'page_too_tall';
    originalHeight: number;
    aspectRatio: number;
  };
  /** Selector scrolled to before capture */
  scrolledTo?: string;
  /** Top-level warning for conditions that may affect interpretation (e.g., partial capture) */
  warning?: string;
}

/**
 * Options for DOM get operation.
 */
export interface DomGetOptions {
  selector?: string;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}

// ============================================================================
// Form Discovery Types
// ============================================================================

/**
 * Field validation state from HTML5 or custom validation.
 */
export interface FieldValidation {
  valid: boolean;
  message?: string | undefined;
  source?: 'native' | 'aria' | 'sibling' | 'heuristic' | undefined;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Option for select/radio fields.
 */
export interface FieldOption {
  value: string;
  label: string;
  selected: boolean;
}

/**
 * Field types supported by form discovery.
 */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'tel'
  | 'url'
  | 'number'
  | 'search'
  | 'date'
  | 'time'
  | 'datetime-local'
  | 'month'
  | 'week'
  | 'color'
  | 'file'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'textarea'
  | 'textbox'
  | 'combobox'
  | 'listbox'
  | 'switch'
  | 'contenteditable'
  | 'hidden'
  | 'unknown';

/**
 * Field state values.
 */
export type FieldState = 'empty' | 'filled' | 'checked' | 'unchecked' | 'partial';

/**
 * Form field discovered on the page.
 */
export interface FormField {
  index: number;
  formIndex: number;
  selector: string;
  type: FormFieldType;
  inputType?: string | undefined;
  label: string;
  name: string | null;
  placeholder?: string | undefined;
  required: boolean;
  /** Name of the radio/checkbox group the field belongs to (counted once in the summary) */
  groupLabel?: string | undefined;
  disabled: boolean;
  readOnly: boolean;
  hidden: boolean;
  native: boolean;
  interactionWarning?: string | undefined;
  state: FieldState;
  value: string | boolean | string[];
  maskedValue?: string | undefined;
  validation: FieldValidation;
  options?: FieldOption[] | undefined;
  /** Form markup errors Chrome reports for the field (e.g. a duplicate id) */
  issues?: string[] | undefined;
  command: string;
  selectorCommand: string;
}

/**
 * Form button discovered on the page.
 */
export interface FormButton {
  index: number;
  selector: string;
  label: string;
  type: 'submit' | 'reset' | 'button';
  primary: boolean;
  enabled: boolean;
  disabledReason?: string | undefined;
  command: string;
}

/**
 * Blocker preventing form submission.
 */
export interface FormBlocker {
  index: number;
  label: string;
  reason: string;
  command: string;
}

/**
 * Summary statistics for a form. Counts cover the visible, editable fields;
 * a radio or checkbox group (same name) counts once, filled when any of its
 * options is checked.
 */
export interface FormSummary {
  totalFields: number;
  filledFields: number;
  emptyFields: number;
  validFields: number;
  invalidFields: number;
  requiredTotal: number;
  requiredFilled: number;
  requiredRemaining: number;
  /** Labels of the fields (choice groups once) left empty, required or not */
  emptyFieldLabels: string[];
  /**
   * Every required field is filled, nothing is invalid, the submit button is
   * enabled, and at least one field is filled (or the form has none)
   */
  readyToSubmit: boolean;
  blockers: FormBlocker[];
}

/**
 * Multi-step form progress indicator.
 */
export interface FormStep {
  current: number;
  total: number;
}

/**
 * Complete form structure with fields, buttons, and summary.
 */
export interface DiscoveredForm {
  index: number;
  name: string | null;
  action: string | null;
  method: string;
  step?: FormStep | undefined;
  relevanceScore: number;
  /** Not visible (not rendered, visibility-hidden, or all its fields are) */
  hidden: boolean;
  /** Shown inside an open dialog: listed first, like visible forms before hidden ones */
  inDialog: boolean;
  /** Host of the open shadow root holding the form, e.g. `x-login#main` */
  shadowHost?: string | undefined;
  fields: FormField[];
  buttons: FormButton[];
  summary: FormSummary;
}

/**
 * Complete form discovery response.
 */
export interface FormDiscoveryResult {
  formCount: number;
  selectedForm: number;
  forms: DiscoveredForm[];
  /** The forms not shown (without `--all`): name and number of visible fields (all fields of a hidden form) */
  otherForms?: Array<{
    index: number;
    name: string | null;
    fieldCount: number;
    hidden: boolean;
    inDialog: boolean;
    shadowHost?: string | undefined;
  }>;
  /** URLs of same-origin iframes holding form fields, which are not listed */
  formsInFrames?: string[] | undefined;
  /** Custom elements whose closed shadow roots hold form fields (not inspectable, so not listed) */
  closedShadowHosts?: string[] | undefined;
  /** Form markup errors Chrome reports for elements that are no listed field (e.g. a label whose `for` matches no id) */
  formIssues?: FormIssue[] | undefined;
  brief?: boolean | undefined;
}

/** Agent whose skill directory receives the bdg skill (`bdg install-skill`). */
export type SkillTarget = 'claude' | 'agents';

/** What `bdg install-skill` did to the skill file in one agent's skill directory. */
export interface InstalledSkill {
  target: SkillTarget;
  path: string;
  status: 'installed' | 'updated' | 'unchanged';
  /** Where the replaced copy was kept (`updated` only) */
  backup?: string;
}
