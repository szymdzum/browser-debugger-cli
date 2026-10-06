/**
 * Composable command option types.
 *
 * Provides building blocks for command options that can be composed
 * to create type-safe command option interfaces with consistent naming.
 *
 * @example
 * ```typescript
 * // Simple command with base options
 * type MyCommandOptions = BaseOptions;
 *
 * // Command with filter support
 * type StatusOptions = BaseOptions & VerboseOptions;
 *
 * // DOM interaction command with index selection
 * type ClickOptions = BaseOptions & IndexOptions;
 * ```
 */

/**
 * Base options available to all commands.
 * All commands should include this as their foundation.
 */
export interface BaseOptions {
  /** Output as JSON instead of human-readable format */
  json?: boolean;
  /** Hide tips and hints (`-q`, accepted by every command) */
  quiet?: boolean;
  /** Named session to act on (`--session`, accepted by every command) */
  session?: string;
}

/**
 * Options for commands with verbose output.
 */
export interface VerboseOptions {
  /** Enable verbose output with additional details */
  verbose?: boolean;
}

/**
 * Options for element selection by index.
 * Used by DOM interaction commands (fill, click, submit, pressKey).
 */
export interface IndexOptions {
  /** 0-based index for selecting nth element matching selector */
  index?: number;
}

/**
 * Options for Chrome process management.
 */
export interface ChromeOptions {
  /** Kill Chrome process on stop */
  killChrome?: boolean;
}

/**
 * Options for cleanup operations.
 */
export interface CleanupOptions {
  /** Force cleanup even if session appears active */
  force?: boolean;
  /** Remove output files */
  removeOutput?: boolean;
  /** Aggressive cleanup - kill all Chrome processes */
  aggressive?: boolean;
  /** Also delete the named session's directory (profile, logs, port) */
  purge?: boolean;
}

/**
 * Options for commands with raw output mode.
 */
export interface RawOptions {
  /** Output raw data without formatting */
  raw?: boolean;
}

/**
 * Options for commands with all/multiple selection.
 */
export interface SelectionOptions {
  /** Select all matching elements */
  all?: boolean;
  /** Select nth element (0-based) */
  nth?: number;
  /** Use specific nodeId directly */
  nodeId?: number;
}

/**
 * Options for screenshot commands.
 */
export interface ScreenshotOptions {
  /** Image format: png or jpeg */
  format?: 'png' | 'jpeg';
  /** JPEG quality 0-100 */
  quality?: number;
  /** Capture full page vs viewport only */
  fullPage?: boolean;
  /** CSS selector for element capture */
  selector?: string;
  /** Cached element index (0-based) from previous query */
  index?: number;
  /** Continuous capture mode to directory */
  follow?: boolean;
  /** Capture interval in ms for follow mode (string from CLI) */
  interval?: string;
  /** Max frames for follow mode (string from CLI) */
  limit?: string;
  /** Auto-resize enabled (--no-resize sets to false via Commander.js convention) */
  resize?: boolean;
  /** Scroll element into view before capture */
  scroll?: string;
}

/**
 * Options for key press commands.
 */
export interface KeyPressOptions {
  /** Number of times to press key */
  times?: number;
  /** Key modifiers (ctrl, alt, shift, meta) */
  modifiers?: string;
}

/**
 * Options for CDP command operations.
 */
export interface CdpMethodOptions {
  /** JSON parameters for CDP method */
  params?: string;
  /** List available methods/domains */
  list?: boolean;
  /** Describe a method's schema */
  describe?: boolean;
  /** Search for methods */
  search?: string;
}

/** Options for stop command */
export type StopCommandOptions = BaseOptions & ChromeOptions;

/** Options for cleanup command */
export type CleanupCommandOptions = BaseOptions & CleanupOptions;

/** Options for status command */
export type StatusCommandOptions = BaseOptions & VerboseOptions;

/** Options for details command */
export type DetailsCommandOptions = BaseOptions & {
  type: 'network' | 'console';
  id: string;
};

/** Options for DOM query command */
export type DomQueryCommandOptions = BaseOptions;

/** Options for DOM get command */
export type DomGetCommandOptions = BaseOptions &
  RawOptions &
  SelectionOptions & {
    /** All of the element's text instead of its first 500 characters (semantic output) */
    full?: boolean;
    /** Which match of the selector (0-based); `--nth` is its alias */
    index?: number;
  };

/** Options for DOM screenshot command */
export type DomScreenshotCommandOptions = BaseOptions & ScreenshotOptions;

/** Options for DOM eval command */
export interface DomEvalCommandOptions extends BaseOptions {
  /** Iframe to evaluate in: index, name/id attribute, or part of the name, id or URL */
  frame?: string;
}

/** Options for DOM frames command */
export type DomFramesCommandOptions = BaseOptions;

/** Options for DOM form command */
export interface FormCommandOptions extends BaseOptions {
  all?: boolean;
  brief?: boolean;
}

/**
 * Options for fill command.
 * Note: Commander parses --no-blur and --no-wait as boolean flags.
 */
export interface FillCommandOptions extends BaseOptions, IndexOptions {
  /** Blur element after filling (--no-blur sets to false) */
  blur: boolean;
  /** Wait for stability after fill (--no-wait sets to false) */
  wait: boolean;
}

/**
 * Options for click command.
 * Note: Commander parses --no-wait as boolean flag.
 */
export interface ClickCommandOptions extends BaseOptions, IndexOptions {
  /** Wait for stability after click (--no-wait sets to false) */
  wait: boolean;
  /** Double-click */
  double?: boolean;
  /** Right-click */
  right?: boolean;
  /** Refuse instead of falling back to DOM events when the mouse can't reach the element */
  strict?: boolean;
}

/**
 * Options for submit command.
 */
export interface SubmitCommandOptions extends BaseOptions, IndexOptions {
  /** Wait for navigation to complete */
  waitNavigation?: boolean;
  /** Wait for network idle (milliseconds) */
  waitNetwork: number;
  /** Timeout (milliseconds) */
  timeout: number;
}

/**
 * Options for pressKey command.
 * Note: Commander parses --no-wait as boolean flag.
 */
export interface PressKeyCommandOptions extends BaseOptions, IndexOptions, KeyPressOptions {
  /** Wait for stability after key press (--no-wait sets to false) */
  wait: boolean;
}

/**
 * Options for scroll command.
 * Supports scrolling to elements, by pixels, or to page boundaries.
 */
export interface ScrollCommandOptions extends BaseOptions, IndexOptions {
  /** Scroll down by pixels */
  down?: number;
  /** Scroll up by pixels */
  up?: number;
  /** Scroll left by pixels */
  left?: number;
  /** Scroll right by pixels */
  right?: number;
  /** Scroll to page top */
  top?: boolean;
  /** Scroll to page bottom */
  bottom?: boolean;
  /** Wait for stability after scroll (--no-wait sets to false) */
  wait: boolean;
}

/**
 * Options for `dom listeners`.
 */
export interface ListenersCommandOptions extends BaseOptions, IndexOptions {
  /** Only these event types (from --type, comma-separated, repeatable) */
  type?: string[];
  /** List every listener of framework roots */
  all?: boolean;
}

/**
 * Options for `dom layout`.
 */
export type LayoutCommandOptions = BaseOptions & IndexOptions;

/**
 * Options for `dom inspect`.
 */
export interface InspectCommandOptions extends BaseOptions, IndexOptions {
  /** Child tree depth (0 for none) */
  tree?: number;
  /** Child tree rows at most */
  treeLimit?: number;
  /** Every non-default property instead of the groups */
  all?: boolean;
  /** Only these properties */
  props?: string[];
  /** Which declaration sets each shown property */
  rules?: boolean;
  /** Every declaration of this property */
  why?: string;
  /** `--no-hints` sets false */
  hints?: boolean;
}

/** Options for `bdg dom wait` */
export interface WaitCommandOptions extends BaseOptions {
  /** Text a match must contain */
  text?: string;
  /** Wait for the matches to be gone */
  gone?: boolean;
  /** Only count visible matches */
  visible?: boolean;
  /** Wait for document.readyState to be complete */
  load?: boolean;
  /** Give up after this many milliseconds */
  timeout: number;
}

/** Options for A11y tree command */
export type A11yTreeCommandOptions = BaseOptions;

/** Options for A11y query command */
export interface A11yQueryCommandOptions extends BaseOptions {
  /** Matches to list (0 = all) */
  limit?: number;
}

/** Options for A11y describe command */
export type A11yDescribeCommandOptions = BaseOptions;

/** Options for CDP command */
export type CdpCommandOptions = BaseOptions & CdpMethodOptions;

/** Options for network cookies command */
export type NetworkCookiesCommandOptions = BaseOptions & { url?: string };

/** Options for network HAR command */
export type NetworkHarCommandOptions = BaseOptions & { outputFile?: string };

/** Options for network headers command */
export type NetworkHeadersCommandOptions = BaseOptions & { header?: string };

/**
 * Options for session start command.
 *
 * CLI-layer shape: fields are "required-with-undefined" (`| undefined`) to
 * match what Commander parsing produces. Maps to the canonical
 * `SessionOptions` (IPC shape) via `filterDefined` in
 * `startSessionViaDaemon`, which strips undefined keys.
 *
 * Kept as its own interface (not `extends SessionOptions`) because
 * `exactOptionalPropertyTypes: true` treats `?: T` and `: T | undefined` as
 * incompatible assignability-wise, and the CLI produces the latter.
 */
export interface SessionStartOptions {
  /** CDP port number (undefined = auto-select) */
  port: number | undefined;
  /** Auto-stop timeout in seconds */
  timeout: number | undefined;
  /** Custom Chrome user data directory */
  userDataDir: string | undefined;
  /** Include all data (disable filtering) */
  includeAll: boolean;
  /** Maximum response body size in MB */
  maxBodySize: number | undefined;
  /** Launch Chrome in headless mode */
  headless: boolean;
  /** Connect to existing Chrome instance via WebSocket URL */
  chromeWsUrl: string | undefined;
  /** Quiet mode - minimal output for AI agents */
  quiet: boolean;
  /** Print the result as a JSON envelope */
  json?: boolean | undefined;
  /** Custom Chrome flags (e.g., ['--ignore-certificate-errors']) */
  chromeFlags: string[] | undefined;
  /** Viewport size to emulate (`--viewport`) */
  viewport?: ViewportSize | undefined;
  /** `prefers-color-scheme` to emulate (`--color-scheme`) */
  colorScheme?: ColorScheme | undefined;
}

// ConsoleLevel is defined in types.ts for proper architectural layering
// Re-export for convenience in command files
export type { ConsoleLevel } from '@/types.js';

// Import locally for use in ConsoleCommandOptions
import type { ColorScheme, ConsoleLevel, ViewportSize } from '@/types.js';

/**
 * Options for console command.
 * Supports smart summary (default), list view (--list), and streaming (--follow).
 * By default shows only current navigation; use --history for all.
 */
export interface ConsoleCommandOptions extends BaseOptions {
  /** Show last N messages (string from CLI, 0 = all, default: 100) */
  last?: string;
  /** List all messages chronologically (default: smart summary) */
  list?: boolean;
  /** Stream console messages in real-time */
  follow?: boolean;
  /** Show messages from all page loads (default: current only) */
  history?: boolean;
  /** Filter by message level (error, warning, info, debug) */
  level?: ConsoleLevel;
}

/**
 * Options for preview display.
 * Shared between peek and tail commands.
 */
export interface PreviewDisplayOptions {
  /** Show only network requests */
  network?: boolean;
  /** Show only console messages */
  console?: boolean;
  /** Use verbose output with full URLs and formatting */
  verbose?: boolean;
  /** Watch for updates (like tail -f) */
  follow?: boolean;
}

/**
 * Options for peek command.
 * Includes preview options plus last count and resource type filter.
 */
export interface PeekCommandOptions extends BaseOptions, PreviewDisplayOptions {
  /** Show last N items (string from CLI, default: 10) */
  last?: string;
  /** Filter network requests by resource type (comma-separated) */
  type?: string;
}

/**
 * Options for tail command.
 * Includes preview options plus last count and update interval.
 */
export interface TailCommandOptions extends BaseOptions, Omit<PreviewDisplayOptions, 'follow'> {
  /** Show last N items (string from CLI, default: 10) */
  last?: string;
  /** Update interval in milliseconds (string from CLI, default: 1000) */
  interval?: string;
}
