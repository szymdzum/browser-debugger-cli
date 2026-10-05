import * as fs from 'fs';

import type { Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CleanupCommandOptions } from '@/commands/shared/optionTypes.js';
import type { CleanupResult } from '@/commands/types.js';
import { purgeNeedsNamedSessionError, sessionDirIsFileError } from '@/errors/messages.js';
import { performSessionCleanup } from '@/session/cleanup/userCommands.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import { getSessionDir, getSessionName } from '@/session/paths.js';
import { readDaemonPid } from '@/session/pid.js';
import { joinLines } from '@/ui/formatting.js';
import {
  sessionFilesCleanedMessage,
  sessionOutputRemovedMessage,
  sessionDirectoryCleanMessage,
  sessionDirectoryPurgedMessage,
  noSessionFilesMessage,
  sessionStillActiveError,
  sessionStillActiveSuggestion,
  warningMessage,
} from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Format cleanup result for human-readable output.
 *
 * @param data - Cleanup result data
 */
function formatCleanup(data: CleanupResult): string {
  const { cleaned } = data;

  return joinLines(
    cleaned.session && sessionFilesCleanedMessage(),
    cleaned.output && sessionOutputRemovedMessage(),
    ...(data.warnings ?? []).map((warning) => warningMessage(warning)),
    '',
    data.message
  );
}

/**
 * Delete the selected named session's directory (Chrome profile, logs, port).
 *
 * @returns The deleted directory, or undefined if there was none
 */
function purgeSessionDir(): string | undefined {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) return undefined;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  return dir;
}

/**
 * Why cleanup cannot run: the session directory is a file, `--purge` lacks a
 * named session, or the session is still running (without `--force`).
 *
 * @param opts - Cleanup options
 * @returns Error result, or null when cleanup may run
 */
async function cleanupBlocker(
  opts: CleanupCommandOptions
): Promise<CommandResult<CleanupResult> | null> {
  const dir = getSessionDir();
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
    const err = sessionDirIsFileError(dir);
    return {
      success: false,
      error: err.message,
      exitCode: EXIT_CODES.SESSION_FILE_ERROR,
      errorContext: { suggestion: err.suggestion },
    };
  }
  if (opts.purge && getSessionName() === null) {
    const err = purgeNeedsNamedSessionError();
    return {
      success: false,
      error: err.message,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: { suggestion: err.suggestion },
    };
  }
  if (!opts.force && !opts.aggressive && (await isDaemonAlive())) {
    return {
      success: false,
      error: sessionStillActiveError(readDaemonPid() ?? 0),
      exitCode: EXIT_CODES.RESOURCE_BUSY,
      errorContext: {
        suggestion: sessionStillActiveSuggestion(getSessionName()),
        warning: 'Force cleanup kills the running daemon and its Chrome',
      },
    };
  }
  return null;
}

/**
 * Clean up the selected session (and delete its directory with `--purge`).
 *
 * @param opts - Cleanup options
 * @returns Command result
 */
async function cleanupSession(opts: CleanupCommandOptions): Promise<CommandResult<CleanupResult>> {
  const blocker = await cleanupBlocker(opts);
  if (blocker) return blocker;
  const { cleaned, warnings } = await performSessionCleanup({
    force: Boolean(opts.force) || Boolean(opts.aggressive),
    removeOutput: opts.removeOutput,
  });
  const purged = opts.purge ? purgeSessionDir() : undefined;
  const didCleanup = Object.values(cleaned).some(Boolean) || purged !== undefined;
  return {
    success: true,
    data: {
      cleaned,
      ...(purged !== undefined && { purged }),
      message: !didCleanup
        ? noSessionFilesMessage()
        : purged !== undefined
          ? sessionDirectoryPurgedMessage(purged)
          : sessionDirectoryCleanMessage(),
      ...(warnings.length > 0 && { warnings }),
    },
  };
}

/**
 * Register cleanup command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean up stale session files')
    .option('-f, --force', 'Kill a running (possibly hung) session, then clean up', false)
    .option('--remove-output', 'Also remove session.json output file', false)
    .option('--aggressive', 'Alias for --force (kept for compatibility)', false)
    .option(
      '--purge',
      "Also delete a named session's directory (Chrome profile, logs, port); needs --session",
      false
    )
    .addOption(jsonOption())
    .action(async (options: CleanupCommandOptions) => {
      await runCommand<CleanupCommandOptions, CleanupResult>(
        cleanupSession,
        options,
        formatCleanup
      );
    });
}
