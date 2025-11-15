import { Option } from 'commander';

import { CommandError } from '@/ui/errors/index.js';
import { invalidLastRangeError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Validation limits for --last option.
 * These constants define the acceptable range for pagination.
 */
const MIN_LAST_ITEMS = 0;
const MAX_LAST_ITEMS = 10000;

/**
 * Shared --json flag for all commands that support JSON output.
 * Standard option for machine-readable output.
 *
 * @example
 * ```typescript
 * program
 *   .command('status')
 *   .addOption(jsonOption)
 *   .action((options) => {
 *     if (options.json) {
 *       console.log(JSON.stringify(data));
 *     }
 *   });
 * ```
 */
export const jsonOption = new Option('-j, --json', 'Output as JSON').default(false);

/**
 * Shared --last <n> option for pagination.
 * Includes built-in validation for sensible limits.
 *
 * @example
 * ```typescript
 * program
 *   .command('console')
 *   .addOption(lastOption)
 *   .action((options) => {
 *     const logs = allLogs.slice(-options.last);
 *   });
 * ```
 */
export const lastOption = new Option(
  '--last <n>',
  'Show last N items (network requests and console messages combined, 0 = all)'
)
  .default(MIN_LAST_ITEMS)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < MIN_LAST_ITEMS || n > MAX_LAST_ITEMS) {
      throw new CommandError(
        invalidLastRangeError(MIN_LAST_ITEMS, MAX_LAST_ITEMS),
        {},
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    return n;
  });

/**
 * Create a --filter option with specified valid choices.
 * Includes built-in validation using Commander's .choices() method.
 *
 * @param validTypes - Array of valid filter values
 * @returns Commander Option instance
 *
 * @example
 * ```typescript
 * program
 *   .command('console')
 *   .addOption(filterOption(['log', 'error', 'warning', 'info']))
 *   .action((options) => {
 *     if (options.filter) {
 *       filtered = logs.filter(log => log.type === options.filter);
 *     }
 *   });
 * ```
 */
export function filterOption(validTypes: string[]): Option {
  return new Option('--filter <type>', `Filter by type (${validTypes.join(', ')})`).choices(
    validTypes
  );
}
