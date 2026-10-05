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
export const SELECTOR_OR_INDEX_ARGUMENT = `CSS selector (${SELECTOR_SCOPE}) or numeric index from query results (0-based)`;

/** Help text after `dom query`'s options: what selectors search and what they cannot */
export const SELECTOR_SCOPE_HELP = `
Selectors search the page, open shadow roots and same-origin iframes (nested ones
included). They cannot reach into closed shadow roots or cross-origin iframes:
use bdg dom eval --frame <frame> for those (see bdg dom frames).`;
