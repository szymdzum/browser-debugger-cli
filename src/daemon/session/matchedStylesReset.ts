/**
 * `dom inspect` keeps slow matched-rules answers for a few seconds, but page
 * state such as `:checked`, `:hover` or `:focus` changes without any CDP
 * event. Every daemon command that may change the page drops them, before
 * and after it runs. Hooking the commands rather than the CDP methods they
 * send keeps `dom inspect`'s own page scripts from clearing its answers, and
 * listing the read-only commands makes a new command reset by default.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { CommandName } from '@/ipc/index.js';
import { resetMatchedStyles } from '@/runtime/dom/inspectRules.js';

/** Commands that leave the page as it is: they read it, or only the telemetry */
const KEEPS_MATCHED_STYLES: ReadonlySet<CommandName> = new Set<CommandName>([
  'session_peek',
  'session_details',
  'session_status',
  'session_har_data',
  'session_network_headers',
  'dom_frames',
  'dom_form_discover',
  'dom_listeners',
  'dom_layout',
  'dom_audit',
  'css_search',
  'dom_inspect',
]);

/**
 * Run a command, dropping the kept matched rules before and after it unless
 * it leaves the page as it is.
 *
 * @param cdp - CDP connection
 * @param name - Command name
 * @param run - The command
 * @returns Its result
 */
export function withMatchedStylesReset<T>(
  cdp: CDPConnection,
  name: CommandName,
  run: () => Promise<T>
): Promise<T> {
  if (KEEPS_MATCHED_STYLES.has(name)) return run();
  const reset = (): void => resetMatchedStyles(cdp);
  reset();
  const result = run();
  void result.then(reset, reset);
  return result;
}
