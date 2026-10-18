/**
 * `bdg debug log|list|hits|clear`: logpoints (#848), the values the page's
 * code had at a source line, logged without pausing the page.
 */

import type { Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import {
  logpointLocationError,
  logpointMaxError,
  type ErrorWithSuggestion,
} from '@/errors/messages.js';
import { debugClear, debugHits, debugList, debugLog } from '@/ipc/client.js';
import type { LogpointHit } from '@/ipc/protocol/debugTypes.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  DEBUG_CLEAR_DESCRIPTION,
  DEBUG_DESCRIPTION,
  DEBUG_HITS_DESCRIPTION,
  DEBUG_LIST_DESCRIPTION,
  DEBUG_LOG_DESCRIPTION,
  DEBUG_LOG_EXAMPLES,
  logpointHitText,
  logpointListText,
  logpointSetText,
  logpointsClearedText,
  NO_LOGPOINT_HITS_TEXT,
  NO_LOGPOINTS_TEXT,
  olderHitsNote,
} from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parseLogpointLocation } from '@/utils/logpointLocation.js';

/** Options of `bdg debug log` */
interface DebugLogOptions extends BaseOptions {
  if?: string;
  max?: string;
}

/** Options of `bdg debug hits` */
interface DebugHitsOptions extends BaseOptions {
  last?: string;
  page?: string;
}

/** A daemon answer as these commands read it */
interface Answer<T> {
  status: string;
  data?: T | undefined;
  error?: string | undefined;
  exitCode?: number | undefined;
  suggestion?: string | undefined;
}

/**
 * A daemon answer as a command result.
 *
 * @param response - Answer
 * @returns Data on success, the daemon's error otherwise
 */
function result<T>(response: Answer<T>): CommandResult<T> {
  if (response.status === 'error' || response.data === undefined) {
    return {
      success: false,
      error: response.error ?? 'The session did not answer',
      exitCode: response.exitCode ?? EXIT_CODES.SOFTWARE_ERROR,
      ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
    };
  }
  return { success: true, data: response.data };
}

/**
 * A failed result for a bad argument.
 *
 * @param error - Message and suggestion
 * @returns Failed result (exit 81)
 */
function invalid<T>(error: ErrorWithSuggestion): CommandResult<T> {
  return {
    success: false,
    error: error.message,
    exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    errorContext: { suggestion: error.suggestion },
  };
}

/**
 * A whole number of at least 1.
 *
 * @param value - Option as typed
 * @returns The number, or undefined when it is not one
 */
function positiveInteger(value: string): number | undefined {
  return /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
}

/**
 * Set a logpoint.
 *
 * @param location - `file:line[:col]`
 * @param expressions - Expressions to log
 * @param options - `--if` and `--max`
 * @returns The logpoint
 */
async function setLogpoint(
  location: string,
  expressions: string[],
  options: DebugLogOptions
): Promise<CommandResult<Awaited<ReturnType<typeof debugLog>>['data']>> {
  const parsed = parseLogpointLocation(location);
  if (!parsed) return invalid(logpointLocationError(location));
  const max = options.max === undefined ? undefined : positiveInteger(options.max);
  if (options.max !== undefined && max === undefined) return invalid(logpointMaxError(options.max));
  return result(
    await debugLog({
      ...parsed,
      expressions,
      ...(options.if !== undefined && { guard: options.if }),
      ...(max !== undefined && { max }),
    })
  );
}

/**
 * Read the logged values.
 *
 * @param id - Logpoint (none: all)
 * @param options - `--last` and `--page`
 * @returns Hits
 */
async function readHits(
  id: string | undefined,
  options: DebugHitsOptions
): Promise<CommandResult<{ hits: LogpointHit[]; omitted?: number }>> {
  const last = options.last === undefined ? undefined : positiveInteger(options.last);
  if (options.last !== undefined && last === undefined) {
    return invalid({
      message: `--last must be a whole number of at least 1 (got "${options.last}")`,
      suggestion: 'Example: bdg debug hits --last 5',
    });
  }
  if (options.page !== undefined && options.page !== 'all') {
    return invalid({
      message: `--page takes "all" (got "${options.page}")`,
      suggestion: 'Without it, hits are those of the page now loaded: bdg debug hits --page all',
    });
  }
  return result(
    await debugHits({
      ...(id !== undefined && { id }),
      ...(last !== undefined && { last }),
      ...(options.page === 'all' && { allPages: true }),
    })
  );
}

/**
 * Register the `debug` command group.
 *
 * @param program - Root command
 */
export function registerDebugCommands(program: Command): void {
  const debug = program.command('debug').description(DEBUG_DESCRIPTION);

  debug
    .command('log')
    .description(DEBUG_LOG_DESCRIPTION)
    .argument('<location>', 'file:line or file:line:col (1-based; file is the end of a script URL)')
    .argument('[expressions...]', 'Expressions to log, each its own argument (none: count hits)')
    .option('--if <expression>', 'Log only when this expression is truthy at the line')
    .option('--max <n>', 'Log at most n hits per page load (default 100); the rest are counted')
    .addOption(jsonOption())
    .addHelpText('after', DEBUG_LOG_EXAMPLES)
    .action(async (location: string, expressions: string[], options: DebugLogOptions) => {
      await runCommand(
        () => setLogpoint(location, expressions, options),
        options,
        (data) => (data ? logpointSetText(data) : '')
      );
    });

  debug
    .command('list')
    .description(DEBUG_LIST_DESCRIPTION)
    .addOption(jsonOption())
    .action(async (options: BaseOptions) => {
      await runCommand(
        async () => result(await debugList()),
        options,
        (data) =>
          data.logpoints.length
            ? data.logpoints.map(logpointListText).join('\n')
            : NO_LOGPOINTS_TEXT
      );
    });

  debug
    .command('hits')
    .description(DEBUG_HITS_DESCRIPTION)
    .argument('[id]', 'Only this logpoint')
    .option('--last <n>', 'Show the newest N hits (default 20)')
    .option('--page <scope>', 'all: hits of every page load, not only the page now loaded')
    .addOption(jsonOption())
    .action(async (id: string | undefined, options: DebugHitsOptions) => {
      await runCommand(
        () => readHits(id, options),
        options,
        (data) => {
          if (data.hits.length === 0) return NO_LOGPOINT_HITS_TEXT;
          const fmt = new OutputFormatter();
          if (data.omitted) fmt.text(olderHitsNote(data.omitted));
          data.hits.forEach((hit) => fmt.text(logpointHitText(hit)));
          return fmt.build();
        }
      );
    });

  debug
    .command('clear')
    .description(DEBUG_CLEAR_DESCRIPTION)
    .argument('[id]', 'Logpoint to remove (none: all)')
    .addOption(jsonOption())
    .action(async (id: string | undefined, options: BaseOptions) => {
      await runCommand(
        async () => result(await debugClear(id === undefined ? {} : { id })),
        options,
        logpointsClearedText
      );
    });
}
