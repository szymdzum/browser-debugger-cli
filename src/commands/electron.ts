/**
 * Electron app connection command.
 *
 * `bdg electron` connects to a running Electron app's CDP endpoint,
 * enabling all bdg commands (dom, cdp, etc.) to work against Electron.
 */

import type { Command } from 'commander';

import { startSessionViaDaemon } from '@/commands/shared/startHelpers.js';
import {
  DEFAULT_ELECTRON_PORT,
  discoverElectronTargets,
  findElectronTarget,
} from '@/connection/electronDiscovery.js';
import type { TelemetryType } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { genericError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('electron');

/**
 * Command options for bdg electron
 */
interface ElectronOptions {
  port?: string;
  target?: string;
  list?: boolean;
  quiet?: boolean;
}

/**
 * Format target for display
 */
function formatTarget(target: { id: string; type: string; title: string; url: string }): string {
  const title = target.title || '(no title)';
  const truncatedTitle = title.length > 50 ? title.slice(0, 47) + '...' : title;
  return `  ${target.type.padEnd(12)} ${target.id.slice(0, 8)}  ${truncatedTitle}`;
}

/**
 * List available Electron targets
 */
async function listTargets(port: number): Promise<void> {
  const targets = await discoverElectronTargets(port);

  if (targets.length === 0) {
    console.error(`No Electron targets found on port ${port}`);
    console.error('');
    console.error('Ensure Electron app is running with --remote-debugging-port');
    console.error(`Example: electron --remote-debugging-port=${port} .`);
    process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
  }

  console.log(`Found ${targets.length} target(s) on port ${port}:\n`);
  console.log('  TYPE         ID        TITLE');
  console.log('  ─────────────────────────────────────────────────');
  for (const target of targets) {
    console.log(formatTarget(target));
  }
  console.log('');
  console.log(`Connect: bdg electron --port ${port}`);
  if (targets.length > 1) {
    console.log(`Select:  bdg electron --port ${port} --target <id>`);
  }
}

/**
 * Connect to Electron app and start session
 */
async function connectToElectron(port: number, targetId?: string, quiet?: boolean): Promise<void> {
  const target = await findElectronTarget(port, targetId);

  if (!target) {
    console.error(genericError(`No Electron targets found on port ${port}`));
    console.error('');
    console.error('Ensure Electron app is running with --remote-debugging-port');
    console.error(`Example: electron --remote-debugging-port=${port} .`);
    console.error('');
    console.error(`List targets: bdg electron --list --port ${port}`);
    process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
  }

  if (!target.webSocketDebuggerUrl) {
    console.error(genericError('Target has no WebSocket debugger URL'));
    process.exit(EXIT_CODES.SOFTWARE_ERROR);
  }

  log.debug(`Connecting to Electron target: ${target.title} (${target.type})`);
  log.debug(`WebSocket URL: ${target.webSocketDebuggerUrl}`);

  // Use same telemetry types as regular Chrome sessions
  const telemetry: TelemetryType[] = ['dom', 'network', 'console'];

  // Start session via daemon with the Electron WebSocket URL
  await startSessionViaDaemon(
    target.url || 'electron://app',
    {
      port,
      timeout: undefined,
      userDataDir: undefined,
      includeAll: false,
      maxBodySize: undefined,
      compact: false,
      headless: false,
      chromeWsUrl: target.webSocketDebuggerUrl,
      quiet: quiet ?? false,
      chromeFlags: undefined,
    },
    telemetry
  );
}

/**
 * Register the electron command
 */
export function registerElectronCommand(program: Command): void {
  program
    .command('electron')
    .description('Connect to a running Electron app')
    .option(
      '-p, --port <number>',
      `CDP port (default: ${DEFAULT_ELECTRON_PORT})`,
      String(DEFAULT_ELECTRON_PORT)
    )
    .option('--target <id>', 'Specific target ID (default: first page target)')
    .option('-l, --list', 'List available targets without connecting')
    .option('-q, --quiet', 'Quiet mode - minimal output')
    .action(async (options: ElectronOptions) => {
      const port = options.port ? parseInt(options.port, 10) : DEFAULT_ELECTRON_PORT;

      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(genericError(`Invalid port: ${options.port}`));
        process.exit(EXIT_CODES.INVALID_ARGUMENTS);
      }

      if (options.list) {
        await listTargets(port);
      } else {
        await connectToElectron(port, options.target, options.quiet);
      }
    });
}
