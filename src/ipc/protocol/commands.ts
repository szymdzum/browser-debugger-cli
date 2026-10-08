/**
 * Session Command Schemas
 *
 * Defines the request/response schemas for commands executed by the daemon's session.
 * Each command has a request schema (input) and response data schema (output).
 */

import type { HintDetails } from '@/errors/notices.js';
import type { AuditCheck, AuditResult, CssSearchResult } from '@/ipc/protocol/auditTypes.js';
import type {
  ClickResult,
  FillResult,
  LayoutResult,
  ListenersResult,
  PressKeyResult,
  RawFormData,
  ScrollResult,
  SubmitResult,
} from '@/ipc/protocol/domTypes.js';
import type { InspectResult } from '@/ipc/protocol/inspectTypes.js';
import type { PageState, SessionActivity } from '@/ipc/session/types.js';
import type { ColorScheme, NetworkRequest, ScreenshotResult, ViewportSize } from '@/types.js';

/**
 * Session peek command request schema.
 */
export interface SessionPeekCommand {
  /** Number of recent items to return. */
  lastN?: number;
  /** Offset from the end (for pagination). Default: 0 (most recent). */
  offset?: number;
  /** Return items of one kind only (the other list is empty; totals are always set). */
  only?: PeekSection;
  /** Include request/response headers in network items (for header filters). */
  withHeaders?: boolean;
}

/** Data kinds returned by peek. */
export type PeekSection = 'network' | 'console';

/**
 * Session peek command response data.
 */
export interface SessionPeekData {
  version: string;
  startTime: number;
  duration: number;
  target: { url: string; title: string };
  activeTelemetry: string[];
  network: Array<{
    requestId: string;
    timestamp: number;
    /** Chrome's monotonic time (seconds) when the request was sent */
    sentTime?: number;
    /** Main-frame navigation (page load) the request belongs to */
    navigationId?: number;
    method: string;
    url: string;
    status?: number;
    mimeType?: string;
    resourceType?: string;
    /** Bytes transferred (for the SIZE column) */
    encodedDataLength?: number;
    /** Failure reason for failed requests */
    errorText?: string;
    /** Milliseconds from start to last byte, failure or redirect (absent while pending) */
    duration?: number;
  }>;
  console: Array<{
    index?: number;
    timestamp: number;
    type: string;
    text: string;
    /** Browser subsystem of a browser message (`network`, `security`, ...) */
    source?: string;
  }>;
  /** Navigation id of the page currently loaded. */
  currentNavigationId: number;
  /** When the page's renderer crashed (epoch ms), while it is not loaded again */
  pageCrashedAt?: number;
  /** Total number of network requests (for pagination). */
  totalNetwork: number;
  /** Total number of console messages (for pagination). */
  totalConsole: number;
  /** Console messages dropped at the limit (the oldest; indices start after them) */
  droppedConsole?: number;
  /** Finished network requests dropped at the request cap (the oldest) */
  droppedNetwork?: number;
  /** Response bodies evicted at the total body budget (the oldest) */
  evictedNetworkBodies?: number;
  /** Whether there are more network items available. */
  hasMoreNetwork?: boolean;
  /** Whether there are more console items available. */
  hasMoreConsole?: boolean;
}

/**
 * Session details command request schema.
 */
export interface SessionDetailsCommand {
  /** Type of item to get details for. */
  itemType: 'network' | 'console';
  /** Unique identifier of the item. */
  id: string;
}

/**
 * Session details command response data.
 */
export interface SessionDetailsData {
  /** The requested item (network request or console message). */
  item: unknown;
}

/**
 * CDP call command request schema.
 */
export interface CdpCallCommand {
  /** CDP method name (e.g., 'Network.getCookies'). */
  method: string;
  /** Optional parameters for the CDP method. */
  params?: Record<string, unknown>;
  /**
   * A bdg page script: `Runtime.evaluate` and `DOM.resolveNode` run in bdg's
   * isolated world, out of reach of built-ins the page replaced (not for
   * `bdg cdp`, whose calls stay in the page's world)
   */
  isolated?: boolean;
}

/**
 * CDP call command response data.
 */
export interface CdpCallData {
  /** Result from CDP method call. */
  result: unknown;
  /** Structured hint suggesting a more efficient alternative. UI formats at boundary. */
  hint?: HintDetails;
}

/**
 * Session status command request schema (no parameters required).
 */
export type SessionStatusCommand = Record<string, unknown>;

/**
 * Session status command response data.
 */
export interface SessionStatusData {
  startTime: number;
  duration: number;
  target: PageState;
  activeTelemetry: string[];
  activity: SessionActivity;
  /** Current navigation counter (increments on each page navigation). */
  navigationId: number;
}

/**
 * Session HAR data command request schema (no parameters required).
 */
export type SessionHARDataCommand = Record<string, unknown>;

/**
 * Session HAR data command response data.
 */
export interface SessionHARDataData {
  /** All collected network requests for HAR export. */
  requests: NetworkRequest[];
}

/**
 * Session network headers command request schema.
 */
export interface SessionNetworkHeadersCommand {
  /** Optional request ID to get headers from. Defaults to main page navigation. */
  id?: string;
  /** Optional header name to filter results. Case-insensitive. */
  headerName?: string;
}

/**
 * Session network headers command response data.
 */
export interface SessionNetworkHeadersData {
  /** URL of the request. */
  url: string;
  /** Request ID for correlation with peek output. */
  requestId: string;
  /** HTTP method. */
  method?: string;
  /** HTTP status (0: failed without a response; missing while pending). */
  status?: number;
  /** Status text sent by the server (empty for HTTP/2). */
  statusText?: string;
  /** Why loading failed, when it did. */
  errorText?: string;
  /** Request headers. */
  requestHeaders: Record<string, string>;
  /** Response headers. */
  responseHeaders: Record<string, string>;
}

/**
 * dom_eval: evaluate a JavaScript expression in the page and return its value.
 */
export interface DomEvalCommand {
  script: string;
  /** Iframe to evaluate in: index, name/id attribute, or URL substring */
  frame?: string;
  /** `--full`: copy an object or array result with every entry */
  full?: boolean;
}

export interface DomEvalData {
  /** JSON value, or a readable description for values JSON cannot represent */
  value: unknown;
  /** JavaScript type of the result */
  type: string;
  /** Object subtype (node, date, array, ...) */
  subtype?: string;
  /** Elements of an array result in the page (`value` holds at most 1000 unless `full`) */
  length?: number;
  /** URL of the iframe the script ran in (with `frame`; empty when it has none) */
  frame?: string;
  /** Set when the page replaced built-ins bdg's copy of the result uses */
  warning?: string;
}

/** An iframe of the page, as listed by `bdg dom frames` */
export interface DomFrame {
  /** 0-based position: depth-first, out-of-process frames after in-process siblings */
  index: number;
  /** Frame URL */
  url: string;
  /** Frame name (`name` attribute or `window.name`) */
  name?: string;
  /** `id` attribute of the iframe element */
  id?: string;
  /**
   * Origin the frame's scripts run with: inherited from the parent for
   * srcdoc and about:blank, `"null"` (opaque) for data: URLs and sandboxes
   * without allow-same-origin
   */
  origin: string;
  /** The page cannot reach its document: the origin differs from the page's, or is opaque */
  crossOrigin: boolean;
  /** Runs in its own renderer process (site isolation) */
  outOfProcess: boolean;
  /** Index of the frame it is nested in (missing for frames of the page itself) */
  parentIndex?: number;
}

/**
 * dom_frames: list the page's iframes (including nested and out-of-process ones).
 */
export type DomFramesCommand = Record<string, never>;

export interface DomFramesData {
  frames: DomFrame[];
}

/**
 * dom_fill: fill a form field, optionally waiting for network stability after.
 */
export interface DomFillCommand {
  selector: string;
  /** CLI working directory (file inputs: relative paths) */
  cwd?: string;
  value: string;
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  blur?: boolean;
  wait?: boolean;
}

export type DomFillData = FillResult;

/**
 * dom_click: click an element, optionally waiting for stability after.
 */
export interface DomClickCommand {
  selector: string;
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  wait?: boolean;
  /** Double or right click, or only hover (default: click) */
  action?: 'click' | 'double' | 'right' | 'hover';
  /** Refuse (exit 90) instead of falling back to DOM events when a real mouse can't reach it */
  strict?: boolean;
}

export type DomClickData = ClickResult;

/**
 * dom_submit: submit a form with smart waiting (navigation / network idle).
 */
export interface DomSubmitCommand {
  selector: string;
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  waitNavigation?: boolean;
  waitNetwork?: number;
  timeout?: number;
}

export type DomSubmitData = SubmitResult;

/**
 * dom_press_key: dispatch a key event on an element.
 */
export interface DomPressKeyCommand {
  selector: string;
  key: string;
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  times?: number;
  modifiers?: string;
  wait?: boolean;
}

export type DomPressKeyData = PressKeyResult;

/**
 * dom_scroll: scroll the page or an element into view.
 */
export interface DomScrollCommand {
  selector?: string;
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  down?: number;
  up?: number;
  left?: number;
  right?: number;
  top?: boolean;
  bottom?: boolean;
  wait?: boolean;
}

export type DomScrollData = ScrollResult;

/**
 * dom_listeners: list the event listeners that run for an element.
 */
export interface DomListenersCommand {
  selector: string;
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  /** Only these event types (default: all) */
  types?: string[];
  /** List every listener of framework roots instead of one summary per node */
  all?: boolean;
}

export type DomListenersData = ListenersResult;

/**
 * dom_layout: positions, sizes and visibility of elements.
 */
export interface DomLayoutCommand {
  selector: string;
  /** Only this match (default: every match) */
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
}

export type DomLayoutData = LayoutResult;

/**
 * dom_audit: page-wide checks (contrast, overflow, layers, animations).
 */
export interface DomAuditCommand {
  checks: AuditCheck[];
  /** WCAG level text must reach (default AA) */
  level?: 'AA' | 'AAA';
  /** Findings listed per check */
  limit?: number;
}

export type DomAuditData = AuditResult;

/**
 * css_search: find text in the page's stylesheets.
 */
export interface CssSearchCommand {
  query: string;
  /** Matches listed at most */
  limit?: number;
}

export type CssSearchData = CssSearchResult;

/**
 * dom_inspect: what one element looks like (styles, box, layout, child tree).
 */
export interface DomInspectCommand {
  selector: string;
  /** Which match (default: the first rendered one, else the first) */
  index?: number;
  /** Exact element from the query cache (overrides selector/index) */
  backendNodeId?: number;
  /** Child tree depth (default 2; 0 for none) */
  tree?: number;
  /** Child tree rows at most (default 20) */
  treeLimit?: number;
  /** Every non-default longhand instead of the groups */
  all?: boolean;
  /** Only these properties (lowercase names) */
  props?: string[];
  /** Check for declarations that have no effect (default true) */
  hints?: boolean;
  /** Report which declaration sets each shown property */
  rules?: boolean;
  /** Report every declaration of this property */
  why?: string;
}

export type DomInspectData = InspectResult;

/**
 * dom_screenshot: capture the page, or one element, as an image. The daemon
 * changes the page's emulation for the capture and puts it back before it
 * answers, so an interrupted CLI cannot leave it changed.
 */
export interface DomScreenshotCommand {
  format: 'png' | 'jpeg';
  /** JPEG quality (default 90) */
  quality?: number;
  /** Keep the full size instead of scaling down to the token budget */
  noResize?: boolean;
  /** Element to capture (the page when absent) */
  backendNodeId?: number;
  /** Element capture: CSS px of page added around the captured area */
  padding?: number;
  /** Page capture: the whole page (default true) */
  fullPage?: boolean;
  /** Page capture: selector scrolled into view first */
  scroll?: string;
}

/** A captured image and what it shows */
export interface DomScreenshotData {
  /** The image, base64-encoded */
  image: string;
  /** What was captured (all a screenshot reports but the file it is written to) */
  screenshot: Omit<ScreenshotResult, 'path'>;
}

/**
 * dom_form_discover: run the form discovery script and return raw form data.
 */
export type DomFormDiscoverCommand = Record<string, never>;

export type DomFormDiscoverData = RawFormData;

/**
 * Command definition structure.
 */
type CommandDef<TReq, TRes> = { requestSchema: TReq; responseSchema: TRes };

/**
 * Shape of the command registry.
 */
export type RegistryShape = {
  session_peek: CommandDef<SessionPeekCommand, SessionPeekData>;
  session_details: CommandDef<SessionDetailsCommand, SessionDetailsData>;
  session_status: CommandDef<SessionStatusCommand, SessionStatusData>;
  session_har_data: CommandDef<SessionHARDataCommand, SessionHARDataData>;
  session_network_headers: CommandDef<SessionNetworkHeadersCommand, SessionNetworkHeadersData>;
  cdp_call: CommandDef<CdpCallCommand, CdpCallData>;
  dom_eval: CommandDef<DomEvalCommand, DomEvalData>;
  dom_frames: CommandDef<DomFramesCommand, DomFramesData>;
  dom_fill: CommandDef<DomFillCommand, DomFillData>;
  dom_click: CommandDef<DomClickCommand, DomClickData>;
  dom_submit: CommandDef<DomSubmitCommand, DomSubmitData>;
  dom_press_key: CommandDef<DomPressKeyCommand, DomPressKeyData>;
  dom_scroll: CommandDef<DomScrollCommand, DomScrollData>;
  dom_form_discover: CommandDef<DomFormDiscoverCommand, DomFormDiscoverData>;
  dom_listeners: CommandDef<DomListenersCommand, DomListenersData>;
  dom_layout: CommandDef<DomLayoutCommand, DomLayoutData>;
  dom_audit: CommandDef<DomAuditCommand, DomAuditData>;
  css_search: CommandDef<CssSearchCommand, CssSearchData>;
  dom_inspect: CommandDef<DomInspectCommand, DomInspectData>;
  dom_screenshot: CommandDef<DomScreenshotCommand, DomScreenshotData>;
  dom_wait: CommandDef<DomWaitCommand, DomWaitData>;
  page_navigate: CommandDef<PageNavigateCommand, PageNavigationResult>;
  page_emulate: CommandDef<PageEmulateCommand, PageEmulationResult>;
};

/** What `bdg page` does */
export type PageAction = 'navigate' | 'reload' | 'back' | 'forward';

/** Result of a page navigation */
export interface PageNavigationResult {
  /** What was done */
  action: PageAction;
  /** URL of the page afterwards (the requested URL with --no-wait) */
  url: string;
  /** Title of the page afterwards */
  title: string;
  /** HTTP status of the new document, when one was loaded */
  status?: number;
  /** Something worth knowing: an HTTP error, a download, a page still loading */
  warning?: string;
  /** The new document had not finished loading within the wait (absent once complete) */
  loading?: PageLoadingState;
}

/** A request the page is still waiting for */
export interface PendingRequestInfo {
  method: string;
  url: string;
  /** CDP resource type (Script, Stylesheet, Image, ...) when known */
  resourceType?: string;
  /** How long it has been running */
  pendingMs: number;
}

/** A document that has not finished loading (`document.readyState` is not `complete`) */
export interface PageLoadingState {
  /** `loading` or `interactive` */
  readyState: string;
  /** The longest-running requests, load-blocking ones (scripts, styles, images, frames) first */
  pending: PendingRequestInfo[];
  /** All requests still running (more than `pending` lists when there are many) */
  pendingCount: number;
}

/**
 * dom_wait: wait until elements matching a selector appear, become visible,
 * contain a text or are gone, and/or the page has loaded.
 */
export interface DomWaitCommand {
  /** Selector (filters like :has-text and :visible allowed); optional with `load` */
  selector?: string;
  /** Text one of the matches must contain (case-insensitive) */
  text?: string;
  /** Wait for the matches (or visible matches with `visible`) to be gone */
  gone?: boolean;
  /** Only count visible matches */
  visible?: boolean;
  /** Also wait for `document.readyState` to be `complete` */
  load?: boolean;
  /** Give up after this many milliseconds */
  timeout: number;
}

/** What the page showed when a `dom wait` condition was met */
export interface DomWaitData {
  selector?: string;
  text?: string;
  gone?: boolean;
  visible?: boolean;
  load?: boolean;
  /** Time from the start of the wait until the condition was met */
  elapsedMs: number;
  /** Elements matching the selector */
  count: number;
  /** Of those, the ones containing `text` (with `text` only) */
  textCount?: number;
  /** Of those (or of the text matches), the visible ones */
  visibleCount: number;
  /** `document.readyState` of the page */
  readyState: string;
}

/**
 * page_navigate: navigate, reload, or go back/forward, then wait for the page.
 */
export interface PageNavigateCommand {
  action: PageAction;
  /** URL to load (navigate) */
  url?: string;
  /** Wait for the page to load (default: true) */
  wait?: boolean;
}

/**
 * page_emulate: change the viewport or color scheme mid-session, or clear both.
 */
export interface PageEmulateCommand {
  viewport?: ViewportSize;
  colorScheme?: ColorScheme;
  /** Clear both: back to the browser window and the system setting */
  reset?: boolean;
}

/** The page after `page emulate` */
export interface PageEmulationResult {
  /** What bdg emulates now (empty after a reset) */
  emulated: { viewport?: ViewportSize; colorScheme?: ColorScheme };
  /** Layout viewport the page has, without scrollbars */
  viewport?: ViewportSize;
  /** `prefers-color-scheme` the page sees */
  colorScheme?: ColorScheme;
}

/**
 * Creates a phantom command definition that carries request/response types only.
 *
 * @returns Empty schema objects typed as the inferred request and response
 */
function defineCommand<TReq, TRes>(): CommandDef<TReq, TRes> {
  return { requestSchema: {} as TReq, responseSchema: {} as TRes };
}

/**
 * Central registry of all session commands.
 * Maps command names to their request/response schemas.
 */
export const COMMANDS: RegistryShape = {
  session_peek: defineCommand(),
  session_details: defineCommand(),
  session_status: defineCommand(),
  session_har_data: defineCommand(),
  session_network_headers: defineCommand(),
  cdp_call: defineCommand(),
  dom_eval: defineCommand(),
  dom_frames: defineCommand(),
  dom_fill: defineCommand(),
  dom_click: defineCommand(),
  dom_submit: defineCommand(),
  dom_press_key: defineCommand(),
  dom_scroll: defineCommand(),
  page_navigate: defineCommand(),
  page_emulate: defineCommand(),
  dom_form_discover: defineCommand(),
  dom_listeners: defineCommand(),
  dom_layout: defineCommand(),
  dom_audit: defineCommand(),
  css_search: defineCommand(),
  dom_inspect: defineCommand(),
  dom_screenshot: defineCommand(),
  dom_wait: defineCommand(),
};

/**
 * All registered command schemas.
 */
export type CommandSchemas = typeof COMMANDS;

/**
 * All valid command names.
 */
export type CommandName = keyof typeof COMMANDS;
