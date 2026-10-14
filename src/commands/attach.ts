/**
 * `bdg attach [tab]`: list the tabs of a running Chrome, or start a session
 * on one of them as it is (never navigated), over one connection to the
 * browser endpoint (#473).
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { assertValidChromeWsUrl, resolveChromeWsUrl } from '@/commands/start.js';
import { listPageTabs, type PageTab } from '@/connection/browserTabs.js';
import { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { attachNeedsChromeWsUrlError } from '@/errors/messages.js';
import { formatTabList } from '@/ui/formatters/attach.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Options of `bdg attach` */
interface AttachOptions extends BaseOptions {
  chromeWsUrl?: string;
  timeout?: string;
  quiet?: boolean;
}

/** Connection attempts for the tab list (Chrome is already running) */
const LIST_CONNECT_ATTEMPTS = 2;

/**
 * The browser WebSocket URL `--chrome-ws-url` names, checked and resolved
 * (a port or HTTP endpoint through its `/json/version`).
 *
 * @param value - Option value
 * @returns Browser WebSocket URL
 * @throws CommandError 81 without the option, 80/101 for a bad or unreachable endpoint
 */
async function browserUrl(value: string | undefined): Promise<string> {
  if (value === undefined) {
    const err = attachNeedsChromeWsUrlError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  assertValidChromeWsUrl(value);
  return (await resolveChromeWsUrl(value)) ?? value;
}

/**
 * The page tabs of the browser, over one connection closed right after.
 *
 * @param wsUrl - Browser WebSocket URL
 * @returns The tabs
 */
async function readTabs(wsUrl: string): Promise<PageTab[]> {
  const cdp = await CDPConnection.create(wsUrl, { maxRetries: LIST_CONNECT_ATTEMPTS });
  try {
    return await listPageTabs(cdp);
  } finally {
    cdp.close();
  }
}

/**
 * Register `bdg attach`.
 *
 * @param program - Root command
 */
export function registerAttachCommand(program: Command): void {
  program
    .command('attach')
    .description('List the tabs of a running Chrome, or attach to one without reloading it')
    .argument('[tab]', 'Index from the list, or a case-insensitive substring of URL or title')
    .option(
      '--chrome-ws-url <url>',
      'Chrome to attach to: debugging port, http://host:port or ws://…/devtools/browser/<id>'
    )
    .option('--timeout <seconds>', 'Auto-stop the session after this many seconds')
    .option('-q, --quiet', 'Quiet mode - minimal output for AI agents', false)
    .addOption(jsonOption())
    .action(async (tab: string | undefined, options: AttachOptions) => {
      let wsUrl: string;
      let timeout: number | undefined;
      try {
        wsUrl = await browserUrl(options.chromeWsUrl);
        timeout =
          options.timeout === undefined
            ? undefined
            : positiveIntRule({ name: '--timeout', min: 1, max: 3600, required: false }).validate(
                options.timeout
              );
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }
      if (tab === undefined) {
        await runCommand<AttachOptions, { tabs: PageTab[] }>(
          async () => ({ success: true, data: { tabs: await readTabs(wsUrl) } }),
          options,
          ({ tabs }) => formatTabList(tabs)
        );
        return;
      }
      await startSessionViaDaemon(
        wsUrl,
        {
          port: undefined,
          timeout,
          userDataDir: undefined,
          includeAll: false,
          maxBodySize: undefined,
          headless: false,
          chromeWsUrl: wsUrl,
          attachTab: tab,
          quiet: options.quiet ?? false,
          json: options.json ?? false,
          chromeFlags: undefined,
        },
        ['dom', 'network', 'console']
      );
    });
}
