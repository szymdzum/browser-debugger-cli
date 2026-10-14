/**
 * `bdg attach [tab]`: list the tabs of a running Chrome, or start a session
 * on one of them as it is (never navigated), over one connection to the
 * browser endpoint (#473). Without `--chrome-ws-url` the endpoint comes from
 * the `DevToolsActivePort` file of Chrome's user data dir (Chrome stable's
 * default, or `--user-data-dir`), which Chrome also writes when remote
 * debugging is enabled at chrome://inspect/#remote-debugging.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { assertValidChromeWsUrl, resolveChromeWsUrl } from '@/commands/start.js';
import { connectToBrowser } from '@/connection/browserConnection.js';
import { listPageTabs, type PageTab } from '@/connection/browserTabs.js';
import {
  defaultChromeUserDataDir,
  discoverBrowser,
  expandHome,
} from '@/connection/devToolsActivePort.js';
import { CommandError } from '@/errors/index.js';
import { attachEndpointConflictError } from '@/errors/messages.js';
import { formatTabList } from '@/ui/formatters/attach.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Options of `bdg attach` */
interface AttachOptions extends BaseOptions {
  chromeWsUrl?: string;
  userDataDir?: string;
  timeout?: string;
  quiet?: boolean;
}

/** The browser to attach to, and the `DevToolsActivePort` file that named it */
interface BrowserEndpoint {
  wsUrl: string;
  activePortFile?: string;
}

/**
 * The browser endpoint: `--chrome-ws-url` checked and resolved (a port or
 * HTTP endpoint through its `/json/version`), else the `DevToolsActivePort`
 * file of `--user-data-dir` or Chrome stable's default profile (no HTTP).
 *
 * @param options - Command options
 * @returns Browser WebSocket URL, and the file it came from
 * @throws CommandError 81 for both options, 83 without a readable file, 80/101 for a bad or unreachable endpoint
 */
async function browserEndpoint(options: AttachOptions): Promise<BrowserEndpoint> {
  const { chromeWsUrl, userDataDir } = options;
  if (chromeWsUrl !== undefined && userDataDir !== undefined) {
    const err = attachEndpointConflictError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  if (chromeWsUrl === undefined) {
    const { wsUrl, file } = discoverBrowser(
      userDataDir === undefined ? defaultChromeUserDataDir() : expandHome(userDataDir)
    );
    return { wsUrl, activePortFile: file };
  }
  assertValidChromeWsUrl(chromeWsUrl);
  return { wsUrl: (await resolveChromeWsUrl(chromeWsUrl)) ?? chromeWsUrl };
}

/**
 * The page tabs of the browser, over one connection closed right after.
 *
 * @param endpoint - The browser
 * @returns The tabs
 */
async function readTabs({ wsUrl, activePortFile }: BrowserEndpoint): Promise<PageTab[]> {
  const cdp = await connectToBrowser(wsUrl, { activePortFile });
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
    .description(
      'List the tabs of a running Chrome, or attach to one without reloading it (finds your Chrome through DevToolsActivePort once remote debugging is enabled at chrome://inspect/#remote-debugging)'
    )
    .argument(
      '[tab]',
      'Index from the list (a number is always an index), or a case-insensitive substring of URL or title'
    )
    .option(
      '--chrome-ws-url <url>',
      'Chrome to attach to: debugging port, http://host:port or ws://…/devtools/browser/<id>'
    )
    .option(
      '--user-data-dir <dir>',
      "Chrome profile dir whose DevToolsActivePort names the browser (default: Chrome stable's; for Canary, Edge, Brave…)"
    )
    .option('--timeout <seconds>', 'Auto-stop the session after this many seconds')
    .option('-q, --quiet', 'Quiet mode - minimal output for AI agents', false)
    .addOption(jsonOption())
    .action(async (tab: string | undefined, options: AttachOptions) => {
      let endpoint: BrowserEndpoint;
      let timeout: number | undefined;
      try {
        endpoint = await browserEndpoint(options);
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
          async () => ({ success: true, data: { tabs: await readTabs(endpoint) } }),
          options,
          ({ tabs }) => formatTabList(tabs)
        );
        return;
      }
      await startSessionViaDaemon(
        endpoint.wsUrl,
        {
          port: undefined,
          timeout,
          userDataDir: undefined,
          includeAll: false,
          maxBodySize: undefined,
          headless: false,
          chromeWsUrl: endpoint.wsUrl,
          activePortFile: endpoint.activePortFile,
          attachTab: tab,
          quiet: options.quiet ?? false,
          json: options.json ?? false,
          chromeFlags: undefined,
        },
        ['dom', 'network', 'console']
      );
    });
}
