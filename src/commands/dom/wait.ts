/**
 * `bdg dom wait [selector]` - wait until elements appear, become visible,
 * contain a text or are gone, and/or the page has loaded, instead of
 * polling with `sleep` and `dom eval`.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { WaitCommandOptions } from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import { waitTargetRequiredError } from '@/errors/messages.js';
import { domWait } from '@/ipc/client.js';
import type { DomWaitData } from '@/ipc/protocol/commands.js';
import { WAIT_HELP_EXAMPLES, waitMetMessage } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

/** Default --timeout */
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

/** Longest --timeout (10 minutes) */
const MAX_WAIT_TIMEOUT_MS = 600_000;

/**
 * Register `bdg dom wait`.
 *
 * @param dom - The `dom` command group
 */
export function registerWaitCommand(dom: Command): void {
  dom
    .command('wait')
    .description(
      'Wait until elements appear, become visible, contain a text or are gone (or the page loads)'
    )
    .argument(
      '[selector]',
      'CSS selector (:has-text, :visible allowed; shadow DOM and same-origin iframes searched); optional with --load'
    )
    .option('--text <text>', 'A match must contain this text (case-insensitive)')
    .option('--visible', 'Only count visible matches')
    .option('--gone', 'Wait until no element matches (none visible, with --visible)')
    .option('--load', 'Also wait for the page to finish loading (document.readyState complete)')
    .option(
      '--timeout <ms>',
      'Give up after this many milliseconds (exit 102)',
      integerOption(1, MAX_WAIT_TIMEOUT_MS),
      DEFAULT_WAIT_TIMEOUT_MS
    )
    .addOption(jsonOption())
    .addHelpText('after', WAIT_HELP_EXAMPLES)
    .action(async (selector: string | undefined, options: WaitCommandOptions) => {
      await runCommand(() => waitFor(selector, options), options, formatWait);
    });
}

/**
 * Validate the options and ask the daemon to wait.
 *
 * @param selector - Selector, if given
 * @param options - Command options
 * @returns Command result
 */
async function waitFor(
  selector: string | undefined,
  options: WaitCommandOptions
): Promise<{
  success: boolean;
  data?: DomWaitData;
  error?: string;
  exitCode?: number;
  errorContext?: { suggestion: string };
}> {
  const needsSelector = options.text !== undefined || options.gone === true || !options.load;
  if (selector === undefined && needsSelector) {
    const err = waitTargetRequiredError();
    return {
      success: false,
      error: err.message,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: { suggestion: err.suggestion },
    };
  }
  const response = await domWait({
    ...filterDefined({ selector, text: options.text }),
    ...(options.gone && { gone: true }),
    ...(options.visible && { visible: true }),
    ...(options.load && { load: true }),
    timeout: options.timeout,
  });
  if (response.status === 'error' || !response.data) {
    return {
      success: false,
      error: response.error ?? 'Failed to wait',
      exitCode: response.exitCode ?? EXIT_CODES.CDP_CONNECTION_FAILURE,
      ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
    };
  }
  return { success: true, data: response.data };
}

/**
 * One line for human output.
 *
 * @param data - What the page showed when the condition was met
 * @returns e.g. `✓ #finish visible after 5.1s`
 */
function formatWait(data: DomWaitData): string {
  return waitMetMessage(data, data.elapsedMs);
}
