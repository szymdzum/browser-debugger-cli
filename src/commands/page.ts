/**
 * `bdg page navigate|reload|back|forward` — move the session's page;
 * `bdg page info` — where it is; `bdg page tabs|switch|close` — its tabs.
 */

import { Option, type Command } from 'commander';

import { noActiveSessionError, runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import {
  abortOnInterrupt,
  interruptExitCode,
  interruptSignal,
} from '@/commands/shared/interrupt.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { parseColorScheme, requestedViewport } from '@/commands/start.js';
import { CommandError } from '@/errors/index.js';
import { javascriptNavigationError, pageSwitchInterruptedError } from '@/errors/messages.js';
import {
  getStatus,
  pageClose,
  pageEmulate,
  pageNavigate,
  pageSwitch,
  pageTabs,
} from '@/ipc/client.js';
import type { PageState } from '@/ipc/index.js';
import type {
  PageAction,
  PageEmulateCommand,
  PageEmulationResult,
  PageNavigationResult,
} from '@/ipc/protocol/commands.js';
import type { PageCloseData, PageSwitchData, PageTabsData } from '@/ipc/protocol/tabTypes.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  PAGE_ACTION_DESCRIPTIONS,
  PAGE_ACTION_DONE,
  PAGE_CLOSE_DESCRIPTION,
  PAGE_EMULATE_DESCRIPTION,
  PAGE_INFO_DESCRIPTION,
  PAGE_SWITCH_DESCRIPTION,
  PAGE_TABS_DESCRIPTION,
  pageEmulateNothingError,
  pageEmulationLines,
  pageLoadingWarning,
  tabListText,
  tabSwitchHint,
  tabSwitchedNote,
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
      const response = await getStatus(undefined, { tabMove: true });
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
  mobile?: boolean;
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
  if (options.viewport === undefined && options.colorScheme === undefined && !options.mobile) {
    const err = pageEmulateNothingError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const viewport = requestedViewport(options.viewport, options.mobile);
  return {
    ...(viewport && { viewport }),
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

/** A daemon answer as the tab commands read it */
interface TabResponse<T> {
  status: string;
  data?: T | undefined;
  error?: string | undefined;
  exitCode?: number | undefined;
  suggestion?: string | undefined;
}

/**
 * Run a tab command through the daemon.
 *
 * @param request - Sends the request
 * @param options - Command options
 * @param format - Human-readable output
 * @param failure - Error when the daemon gives none
 */
async function runTabCommand<T>(
  request: () => Promise<TabResponse<T>>,
  options: BaseOptions,
  format: (data: T) => string,
  failure: string
): Promise<void> {
  await runCommand(
    async () => {
      const response = await request();
      if (response.status === 'error' || !response.data) {
        return {
          success: false,
          error: response.error ?? failure,
          exitCode: response.exitCode ?? EXIT_CODES.SOFTWARE_ERROR,
          ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
        };
      }
      return { success: true, data: response.data };
    },
    options,
    format
  );
}

/**
 * Ask the daemon for a tab switch. Ctrl-C or SIGTERM does not drop the
 * request: the command waits for the answer (a second signal exits at once),
 * then fails with exit 130 (143) saying whether the switch completed.
 *
 * @param target - Index, target id or part of the URL
 * @param interrupt - Aborted on Ctrl-C or SIGTERM
 * @param send - Sends the request
 * @returns The daemon's answer, when not interrupted
 * @throws CommandError (130/143) once interrupted, naming the session's tab
 */
export async function switchTab(
  target: string,
  interrupt: AbortSignal,
  send: (params: { target: string }) => Promise<TabResponse<PageSwitchData>> = pageSwitch
): Promise<TabResponse<PageSwitchData>> {
  if (interrupt.aborted) throw switchInterrupted(interrupt, undefined);
  const response = await send({ target });
  if (interrupt.aborted) throw switchInterrupted(interrupt, response);
  return response;
}

/**
 * The error of an interrupted `bdg page switch`.
 *
 * @param interrupt - The aborted interrupt
 * @param response - The daemon's answer, if the request was sent
 * @returns Command error (130 for Ctrl-C, 143 for SIGTERM)
 */
function switchInterrupted(
  interrupt: AbortSignal,
  response: TabResponse<PageSwitchData> | undefined
): CommandError {
  const signal = interruptSignal(interrupt);
  const data = response?.status === 'ok' ? response.data : undefined;
  const outcome =
    response === undefined
      ? undefined
      : data
        ? { tab: data.tab, switched: data.previous !== undefined }
        : { error: response.error ?? 'no answer' };
  const err = pageSwitchInterruptedError(signal, outcome);
  return new CommandError(err.message, { suggestion: err.suggestion }, interruptExitCode(signal));
}

/**
 * `bdg page tabs` output.
 *
 * @param data - Tabs
 * @returns Text
 */
function formatTabs(data: PageTabsData): string {
  return new OutputFormatter()
    .text(`Tabs (${data.tabs.length}):`)
    .text(data.tabs.map(tabListText).join('\n'))
    .blank()
    .text(tabSwitchHint())
    .build();
}

/**
 * `bdg page switch` output.
 *
 * @param data - The tab switched to
 * @returns Text
 */
function formatSwitch(data: PageSwitchData): string {
  const fmt = new OutputFormatter()
    .text(
      data.previous ? `✓ Switched to tab ${data.tab.index}` : `✓ Already on tab ${data.tab.index}`
    )
    .keyValueList(
      [
        ['URL', data.tab.url],
        ['Title', data.tab.title],
      ],
      8
    );
  if (data.previous) fmt.text(tabSwitchedNote(data.previous));
  return fmt.build();
}

/**
 * `bdg page close` output.
 *
 * @param data - What was closed and the session's tab now
 * @returns Text
 */
function formatClose(data: PageCloseData): string {
  return new OutputFormatter()
    .text(`✓ Closed tab: ${data.closed.url}`)
    .keyValue(
      data.switched ? 'Now on' : 'Session tab',
      `[${data.current.index}] ${data.current.url}`,
      14
    )
    .build();
}

/**
 * Register `bdg page tabs`, `switch` and `close`.
 *
 * @param page - The `page` command group
 */
function registerTabCommands(page: Command): void {
  page
    .command('tabs')
    .description(PAGE_TABS_DESCRIPTION)
    .addOption(jsonOption())
    .action(async (options: BaseOptions) => {
      await runTabCommand(() => pageTabs(), options, formatTabs, 'Failed to list the tabs');
    });

  page
    .command('switch')
    .description(PAGE_SWITCH_DESCRIPTION)
    .argument(
      '<target>',
      '0-based index from bdg page tabs, a target id, or part of the URL (url:<part> for one of only digits)'
    )
    .addOption(jsonOption())
    .action(async (target: string, options: BaseOptions) => {
      const interrupt = abortOnInterrupt();
      await runTabCommand(
        () => switchTab(target, interrupt),
        options,
        formatSwitch,
        'Failed to switch tabs'
      );
    });

  page
    .command('close')
    .description(PAGE_CLOSE_DESCRIPTION)
    .argument(
      '[target]',
      '0-based index from bdg page tabs, a target id, or part of the URL (url:<part> for one of only digits)'
    )
    .addOption(jsonOption())
    .action(async (target: string | undefined, options: BaseOptions) => {
      await runTabCommand(
        () => pageClose(target === undefined ? {} : { target }),
        options,
        formatClose,
        'Failed to close the tab'
      );
    });
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
      'The session page: info (URL and title), navigate <url>, reload, back, forward, emulate (viewport, color scheme), tabs, switch, close'
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
    .option(
      '--viewport <WxH>',
      'Viewport size in CSS px, e.g. 900x700 (a desktop one unless --mobile)'
    )
    .option('--color-scheme <scheme>', 'Emulate prefers-color-scheme: light or dark')
    .option(
      '--mobile',
      'Emulate a phone: mobile viewport (390x844 unless --viewport), touch, mobile user agent'
    )
    .addOption(
      new Option('--reset', 'Back to the browser window size and the system setting').conflicts([
        'viewport',
        'colorScheme',
        'mobile',
      ])
    )
    .addOption(jsonOption())
    .action(async (options: PageEmulateOptions) => {
      await emulate(options);
    });

  registerTabCommands(page);

  for (const action of ['reload', 'back', 'forward'] as const) {
    withCommon(page.command(action).description(PAGE_ACTION_DESCRIPTIONS[action])).action(
      async (options: PageCommandOptions) => {
        await runPageAction(action, options);
      }
    );
  }
}
