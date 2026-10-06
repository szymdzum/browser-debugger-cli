/**
 * `bdg page navigate|reload|back|forward` — move the session's page;
 * `bdg page info` — where it is.
 */

import { Option, type Command } from 'commander';

import { noActiveSessionError, runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { parseColorScheme, parseViewport } from '@/commands/start.js';
import { CommandError } from '@/errors/index.js';
import { javascriptNavigationError } from '@/errors/messages.js';
import { getStatus, pageEmulate, pageNavigate } from '@/ipc/client.js';
import type { PageState } from '@/ipc/index.js';
import type {
  PageAction,
  PageEmulateCommand,
  PageEmulationResult,
  PageNavigationResult,
} from '@/ipc/protocol/commands.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  PAGE_ACTION_DESCRIPTIONS,
  PAGE_ACTION_DONE,
  PAGE_EMULATE_DESCRIPTION,
  PAGE_INFO_DESCRIPTION,
  pageEmulateNothingError,
  pageEmulationLines,
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
 * `bdg page info`: URL and title of the session page.
 *
 * @param options - Command options
 */
async function showPageInfo(options: BaseOptions): Promise<void> {
  await runCommand(
    async () => {
      const response = await getStatus();
      if (response.status === 'error') {
        return {
          success: false,
          error: response.error ?? 'Failed to read the page',
          exitCode: EXIT_CODES.SOFTWARE_ERROR,
        };
      }
      const page = response.data?.sessionPid ? response.data.pageState : undefined;
      if (!page) throw noActiveSessionError();
      return { success: true, data: { url: page.url, title: page.title } };
    },
    options,
    (page: Pick<PageState, 'url' | 'title'>) =>
      new OutputFormatter()
        .keyValueList(
          [
            ['URL', page.url],
            ['Title', page.title],
          ],
          8
        )
        .build()
  );
}

/** Options of `bdg page emulate` */
interface PageEmulateOptions extends BaseOptions {
  viewport?: string;
  colorScheme?: string;
  reset?: boolean;
}

/**
 * The emulation request from the options.
 *
 * @param options - Command options
 * @returns Request
 * @throws CommandError (81) for nothing to change or an invalid value
 */
function emulationRequest(options: PageEmulateOptions): PageEmulateCommand {
  if (options.reset) return { reset: true };
  if (options.viewport === undefined && options.colorScheme === undefined) {
    const err = pageEmulateNothingError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return {
    ...(options.viewport !== undefined && { viewport: parseViewport(options.viewport) }),
    ...(options.colorScheme !== undefined && {
      colorScheme: parseColorScheme(options.colorScheme),
    }),
  };
}

/**
 * `bdg page emulate`: change the viewport or color scheme mid-session.
 *
 * @param options - Command options
 */
async function emulate(options: PageEmulateOptions): Promise<void> {
  await runCommand(
    async () => {
      const response = await pageEmulate(emulationRequest(options));
      if (response.status === 'error' || !response.data) {
        return {
          success: false,
          error: response.error ?? 'Failed to change the emulation',
          exitCode: response.exitCode ?? EXIT_CODES.SOFTWARE_ERROR,
          ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
        };
      }
      return { success: true, data: response.data };
    },
    options,
    (result: PageEmulationResult) =>
      new OutputFormatter()
        .text('✓ Page emulation changed')
        .keyValueList(pageEmulationLines(result), 10)
        .build()
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
    .description(
      'The session page: info (URL and title), navigate <url>, reload, back, forward, emulate (viewport, color scheme)'
    );

  page
    .command('info')
    .description(PAGE_INFO_DESCRIPTION)
    .addOption(jsonOption())
    .action(async (options: BaseOptions) => {
      await showPageInfo(options);
    });

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

  page
    .command('emulate')
    .description(PAGE_EMULATE_DESCRIPTION)
    .option('--viewport <WxH>', 'Viewport size in CSS px, e.g. 900x700')
    .option('--color-scheme <scheme>', 'Emulate prefers-color-scheme: light or dark')
    .addOption(
      new Option('--reset', 'Back to the browser window size and the system setting').conflicts([
        'viewport',
        'colorScheme',
      ])
    )
    .addOption(jsonOption())
    .action(async (options: PageEmulateOptions) => {
      await emulate(options);
    });

  for (const action of ['reload', 'back', 'forward'] as const) {
    withCommon(page.command(action).description(PAGE_ACTION_DESCRIPTIONS[action])).action(
      async (options: PageCommandOptions) => {
        await runPageAction(action, options);
      }
    );
  }
}
