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
