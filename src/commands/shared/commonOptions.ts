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
