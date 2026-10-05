/**
 * `bdg page navigate|reload|back|forward` — move the session's page.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { javascriptNavigationError } from '@/errors/messages.js';
import { pageNavigate } from '@/ipc/client.js';
import type { PageAction, PageNavigationResult } from '@/ipc/protocol/commands.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  PAGE_ACTION_DESCRIPTIONS,
  PAGE_ACTION_DONE,
  pageLoadingWarning,
} from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { validateUrl } from '@/utils/url.js';

/** Options of the page commands */
interface PageCommandOptions extends BaseOptions {
  /** Wait for the page to load (--no-wait sets false) */
  wait: boolean;
}

/**
 * Human-readable result.
 *
 * @param result - Page after the action
 * @returns Text
 */
function formatPageResult(result: PageNavigationResult): string {
  const fmt = new OutputFormatter()
    .text(`✓ ${PAGE_ACTION_DONE[result.action]}`)
    .keyValueList(
      [
        ['URL', result.url],
        ['Title', result.title],
        ...(result.status !== undefined
          ? [['Status', String(result.status)] as [string, string]]
          : []),
      ],
      8
    );
  if (result.warning) fmt.text(`⚠ ${result.warning}`);
  if (result.loading) fmt.text(`⚠ ${pageLoadingWarning(result.loading)}`);
  return fmt.build();
}

/**
 * Whether a URL is a `javascript:` URL, which runs a script instead of
 * loading a page (bdg points to `dom eval`; other schemes load normally).
 *
 * @param url - URL given
 * @returns True for the javascript scheme
 */
function isScriptUrl(url: string): boolean {
  const [scheme = ''] = url.trim().split(':', 1);
  return url.includes(':') && scheme.toLowerCase() === 'javascript';
}

/**
 * Run a page action through the daemon.
 *
 * @param action - What to do
 * @param options - Command options
 * @param url - URL for navigate
 */
async function runPageAction(
  action: PageAction,
  options: PageCommandOptions,
  url?: string
): Promise<void> {
  await runCommand(
    async () => {
      if (url !== undefined && isScriptUrl(url)) {
        const err = javascriptNavigationError();
        return {
          success: false,
          error: err.message,
          exitCode: EXIT_CODES.INVALID_URL,
          errorContext: { suggestion: err.suggestion },
        };
      }
      if (url !== undefined) {
        const check = validateUrl(url);
        if (!check.valid) {
          return {
            success: false,
            error: check.error,
            exitCode: EXIT_CODES.INVALID_URL,
            ...(check.suggestion && { errorContext: { suggestion: check.suggestion } }),
          };
        }
      }
      const response = await pageNavigate({
        action,
        ...(url !== undefined && { url }),
        wait: options.wait !== false,
      });
      if (response.status === 'error' || !response.data) {
        return {
          success: false,
          error: response.error ?? `Failed to ${action}`,
          exitCode: response.exitCode ?? EXIT_CODES.SOFTWARE_ERROR,
          ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
        };
      }
      return { success: true, data: response.data };
    },
    options,
    formatPageResult
  );
}

/**
 * Register the `page` command group.
 *
 * @param program - Root command
 */
export function registerPageCommands(program: Command): void {
  const page = program
    .command('page')
    .description('Navigate the session page: navigate <url>, reload, back, forward');

  const withCommon = (command: Command): Command =>
    command
      .option('--no-wait', 'Return without waiting for the page to load')
      .addOption(jsonOption());

  withCommon(
    page
      .command('navigate')
      .description('Load a URL in the session page')
      .argument('<url>', 'URL to load')
  ).action(async (url: string, options: PageCommandOptions) => {
    await runPageAction('navigate', options, url);
  });

  for (const action of ['reload', 'back', 'forward'] as const) {
    withCommon(page.command(action).description(PAGE_ACTION_DESCRIPTIONS[action])).action(
      async (options: PageCommandOptions) => {
        await runPageAction(action, options);
      }
    );
  }
}
