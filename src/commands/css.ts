/**
 * `bdg css search <text>` - find text in the page's stylesheets, including
 * cross-origin ones that page scripts cannot read: where a token is set, which
 * rules use `oklch(`, a class or a custom property.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import { cssSearch } from '@/ipc/client.js';
import type { CssSearchResult } from '@/ipc/protocol/auditTypes.js';
import { formatCssSearch } from '@/ui/formatters/audit.js';
import { CSS_SEARCH_HELP_EXAMPLES } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Options of `bdg css search` */
interface CssSearchOptions extends BaseOptions {
  limit?: number;
}

/**
 * Register the `css` command group.
 *
 * @param program - Root command
 */
export function registerCssCommands(program: Command): void {
  const css = program.command('css').description("The page's stylesheets: search <text>");
  css
    .command('search')
    .description(
      'Find text in every stylesheet of the page (cross-origin ones too), with the rule and file:line'
    )
    .argument(
      '<text>',
      'Text to find (case-insensitive), e.g. oklch( or .btn-primary; put -- before one that starts with - (-- --brand)'
    )
    .option('--limit <n>', 'Matches listed (default: 20)', integerOption(1, 500))
    .addOption(jsonOption())
    .addHelpText('after', CSS_SEARCH_HELP_EXAMPLES)
    .action(async (text: string, options: CssSearchOptions) => {
      await runCommand(() => search(text, options), options, formatCssSearch);
    });
}

/**
 * Ask the daemon to search the stylesheets.
 *
 * @param text - Text to find
 * @param options - Limit
 * @returns Command result
 */
async function search(
  text: string,
  options: CssSearchOptions
): Promise<{
  success: boolean;
  data?: CssSearchResult;
  error?: string;
  exitCode?: number;
  errorContext?: { suggestion: string };
}> {
  const response = await cssSearch({
    query: text,
    ...(options.limit !== undefined && { limit: options.limit }),
  });
  if (response.status === 'error' || !response.data) {
    return {
      success: false,
      error: response.error ?? 'Failed to search the stylesheets',
      exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
      ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
    };
  }
  return { success: true, data: response.data };
}
