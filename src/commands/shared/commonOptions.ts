import { Option } from 'commander';

/**
 * Create a --json flag for machine-readable output.
 *
 * Returns a new Option instance each time to avoid Commander.js state issues
 * when the same option is used across multiple commands/subcommands.
 *
 * @returns Commander Option instance for --json flag
 *
 * @example
 * ```typescript
 * program
 *   .command('status')
 *   .addOption(jsonOption())
 *   .action((options) => {
 *     if (options.json) {
 *       console.log(JSON.stringify(data));
 *     }
 *   });
 * ```
 */
export function jsonOption(): Option {
  return new Option('-j, --json', 'Output as JSON').default(false);
}

/**
 * Create the `--include-sensitive` flag of the commands that mask
 * credentials by default: `network details` and `network headers` (headers, cookies, bodies, WebSocket messages and the
 * request URL), and `status`, `sessions`, `page info`, `page tabs`,
 * `network list` and `peek` (the query and fragment tokens of page URLs;
 * their `user:pass@` is never shown, #623).
 *
 * @returns Commander Option instance for --include-sensitive
 */
export function includeSensitiveOption(): Option {
  return new Option(
    '--include-sensitive',
    'Show credentials as captured, masked as •••• by default: the query and fragment tokens of page URLs (user:pass@ is always removed); on network details and network headers also auth/cookie/API key/token headers, cookie values, password and token fields of bodies and WebSocket messages, and secret form-control values of HTML bodies'
  );
}

/**
 * `--network` together with `--console` asks for both sections, which is what
 * neither flag shows; clear both so the output is not empty.
 *
 * @param options - Parsed `peek`/`tail` options (changed in place)
 */
export function showBothSectionsWhenBothRequested(options: {
  network?: boolean;
  console?: boolean;
}): void {
  if (options.network && options.console) {
    options.network = false;
    options.console = false;
  }
}

/** Where selectors search, for the help of commands that take one */
const SELECTOR_SCOPE = 'searches open shadow roots and same-origin iframes';

/** Help of a `<selectorOrIndex>` argument */
export const SELECTOR_OR_INDEX_ARGUMENT = `CSS selector (${SELECTOR_SCOPE}) or numeric index into the last dom query, dom form or dom a11y query list (0-based)`;

/** Help text after `dom query`'s options: what the node id in --json is */
export const NODE_ID_HELP = `
backendNodeId in --json (dom query, dom get --raw) is the backend node id: pass it
to CDP as backendNodeId (bdg cdp DOM.resolveNode --params '{"backendNodeId":N}')
or to dom get --node-id. nodeId there has the same value and stays until 1.0.
In the default dom get view and in dom a11y output nodeId is the accessibility
node id (a string) and backendDOMNodeId is the backend one.`;

/** Help text after `dom query`'s options: what selectors search and what they cannot */
export const SELECTOR_SCOPE_HELP = `
Selectors search the page, open shadow roots and same-origin iframes (nested ones
included). They cannot reach into closed shadow roots or cross-origin iframes:
use bdg eval --frame <frame> for those (see bdg dom frames).`;

/** Help text after `eval`'s options: what a script leaves on the page */
export const EVAL_SCOPE_HELP = `
The script runs like the DevTools console (top-level await; the value of the
last expression is the result), in a block of its own: its top-level const,
let and class are gone after the call, so they never clash with the page or a
later eval. var and function declarations, and window.x = ..., stay on the
page as globals. Console messages and errors name it bdg-eval (bdg-eval:1:9).`;

/** Help text after `dom query`'s options: how a match's classes are shown */
export const QUERY_CLASS_HELP = `
Each match shows its first class and how many more it has (class="px-2 +4");
the full list is in --json (classes, [] when none), bdg dom get <index> --json
(domContext.classes) and bdg dom get <index> --raw.`;
