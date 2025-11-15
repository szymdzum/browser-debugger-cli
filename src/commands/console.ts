import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { filterOption, jsonOption, lastOption } from '@/commands/shared/commonOptions.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { BdgOutput, ConsoleMessage } from '@/types.js';
import { joinLines } from '@/ui/formatting.js';
import { noConsoleMessagesMessage, consoleMessagesHeader } from '@/ui/messages/consoleMessages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for console command.
 */
interface ConsoleOptions extends BaseCommandOptions {
  /** Number of last messages to show (0 = all) */
  last: number;
  /** Filter by console message type */
  filter?: string;
}

/**
 * Format single console message for human-readable output.
 *
 * @param log - Console message to format
 * @param index - Message index in the list
 * @returns Formatted message string
 */
function formatConsoleMessage(log: ConsoleMessage, index: number): string {
  const icons: Record<string, string> = {
    log: 'ℹ',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };
  const icon = icons[log.type] ?? 'ℹ';
  const timestamp = new Date(log.timestamp).toISOString();

  let output = `[${index}] ${icon} [${timestamp}] ${log.text}`;

  if (log.args && log.args.length > 0) {
    log.args.forEach((arg) => {
      output += `\n    ${JSON.stringify(arg)}`;
    });
  }

  return output;
}

/**
 * Format console messages for human-readable output.
 *
 * @param data - Object containing logs array and optional filter
 */
function formatConsoleLogs(data: { logs: ConsoleMessage[]; filter?: string }): string {
  const { logs, filter } = data;

  if (logs.length === 0) {
    return noConsoleMessagesMessage(filter);
  }

  return joinLines(
    consoleMessagesHeader(logs.length, filter),
    '',
    ...logs.map((log, idx) => formatConsoleMessage(log, idx))
  );
}

/**
 * Register console command.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerConsoleCommand(program: Command): void {
  program
    .command('console')
    .description('Query console logs from the active session')
    .addOption(lastOption)
    .addOption(filterOption(['log', 'error', 'warning', 'info']))
    .addOption(jsonOption)
    .action(async (options: ConsoleOptions) => {
      await runCommand(
        async (opts) => {
          // Fetch preview data via IPC from daemon
          const response = await getPeek();

          // Validate IPC response (throws on error)
          validateIPCResponse(response);

          // Extract preview data from response
          const output = response.data?.preview as BdgOutput | undefined;
          if (!output?.data.console) {
            return {
              success: false,
              error: 'No console data available. Ensure console telemetry is active.',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
            };
          }

          let logs = [...output.data.console];

          // Apply type filter if specified (Commander validates choices)
          if (opts.filter) {
            logs = logs.filter((log) => log.type === opts.filter);
          }

          // Apply last N filter if specified (Commander validates range)
          if (opts.last > 0) {
            logs = logs.slice(-opts.last);
          }

          return {
            success: true,
            data: { logs, ...(opts.filter && { filter: opts.filter }) },
          };
        },
        options,
        formatConsoleLogs
      );
    });
}
