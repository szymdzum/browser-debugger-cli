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
  /** 1-based index for selecting nth element matching selector */
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
  /** Select nth element (1-based) */
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
 * Options for port configuration.
 * Commander passes port as string from CLI.
 */
export interface PortOptions {
  /** CDP port number (string from CLI) */
  port?: string;
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
export type DomGetCommandOptions = BaseOptions & RawOptions & SelectionOptions;

/** Options for DOM screenshot command */
export type DomScreenshotCommandOptions = BaseOptions & ScreenshotOptions;

/** Options for DOM eval command */
export type DomEvalCommandOptions = BaseOptions & PortOptions;

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
}

/**
 * Options for submit command.
 * Note: waitNetwork and timeout come as strings from Commander.
 */
export interface SubmitCommandOptions extends BaseOptions, IndexOptions {
  /** Wait for navigation to complete */
  waitNavigation?: boolean;
  /** Wait for network idle (milliseconds as string) */
  waitNetwork: string;
  /** Timeout (milliseconds as string) */
  timeout: string;
}

/**
 * Options for pressKey command.
 * Note: Commander parses --no-wait as boolean flag.
 */
export interface PressKeyCommandOptions extends BaseOptions, IndexOptions, KeyPressOptions {
  /** Wait for stability after key press (--no-wait sets to false) */
  wait: boolean;
}

/** Options for A11y tree command */
export type A11yTreeCommandOptions = BaseOptions;

/** Options for A11y query command */
export type A11yQueryCommandOptions = BaseOptions;

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

/** Options for console command (last has default 0 via Commander) */
export type ConsoleCommandOptions = BaseOptions & { last: number; filter?: string };

/**
 * Options for preview display.
 * Shared between peek and tail commands.
 */
export interface PreviewDisplayOptions {
  /** Show only network requests */
  network?: boolean;
  /** Show only console messages */
  console?: boolean;
  /** Show DOM/A11y tree data */
  dom?: boolean;
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
export interface TailCommandOptions
  extends BaseOptions,
    Omit<PreviewDisplayOptions, 'dom' | 'follow'> {
  /** Show last N items (string from CLI, default: 10) */
  last?: string;
  /** Update interval in milliseconds (string from CLI, default: 1000) */
  interval?: string;
}
