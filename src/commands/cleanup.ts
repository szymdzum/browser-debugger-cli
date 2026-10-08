import * as fs from 'fs';

import type { Command } from 'commander';

import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CleanupCommandOptions } from '@/commands/shared/optionTypes.js';
import type { CleanupResult } from '@/commands/types.js';
import {
  purgeNeedsNamedSessionError,
  purgeRefusedError,
  sessionDirIsFileError,
  type ErrorWithSuggestion,
} from '@/errors/messages.js';
import { isSessionChrome } from '@/session/cleanup/staleSession.js';
import { performSessionCleanup } from '@/session/cleanup/userCommands.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import {
  getSessionDir,
  getSessionDownloadsDir,
  getSessionFilePath,
  getSessionName,
} from '@/session/paths.js';
import { readDaemonPid, readPidFromFile } from '@/session/pid.js';
import { joinLines } from '@/ui/formatting.js';
import {
  downloadsKeptMessage,
  sessionFilesCleanedMessage,
  sessionOutputRemovedMessage,
  sessionDirectoryCleanMessage,
  sessionDirectoryPurgedMessage,
  noSessionFilesMessage,
  sessionStillActiveError,
  sessionStillActiveSuggestion,
  warningMessage,
} from '@/ui/messages/commands.js';
import { delay } from '@/utils/async.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { isProcessAlive } from '@/utils/process.js';

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
    data.downloadsKept && downloadsKeptMessage(data.downloadsKept.dir, data.downloadsKept.files),
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

/** How long `--purge` waits for a killed Chrome to exit */
const PURGE_CHROME_EXIT_WAIT_MS = 5000;

/**
 * The running Chrome bdg launched for the selected session (from chrome.pid,
 * verified by its marker flag).
 *
 * @returns Chrome PID, or null
 */
function liveSessionChromePid(): number | null {
  const pid = readPidFromFile(getSessionFilePath('CHROME_PID'));
  if (pid === null || !isProcessAlive(pid)) return null;
  return isSessionChrome(pid, getSessionDir()) ? pid : null;
}

/**
 * Wait until a process has exited.
 *
 * @param pid - Process ID
 * @param timeoutMs - Longest wait
 * @returns True if it exited
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) await delay(50);
  return !isProcessAlive(pid);
}

/**
 * Why the session directory must not be deleted after cleanup: its daemon
 * still runs, cleanup reported problems, or its Chrome has not exited.
 *
 * @param chromePid - The session's Chrome as found before cleanup, or null
 * @param warnings - Warnings from cleanup
 * @param exitWaitMs - How long to wait for that Chrome to exit
 * @returns Error and suggestion, or null when the directory may be deleted
 */
export async function purgeBlocker(
  chromePid: number | null,
  warnings: string[],
  exitWaitMs = PURGE_CHROME_EXIT_WAIT_MS
): Promise<ErrorWithSuggestion | null> {
  const dir = getSessionDir();
  if (await isDaemonAlive()) return purgeRefusedError(dir, 'its daemon is still running');
  if (warnings.length > 0) return purgeRefusedError(dir, warnings.join('; '));
  if (chromePid !== null && !(await waitForExit(chromePid, exitWaitMs))) {
    return purgeRefusedError(dir, `its Chrome (PID ${chromePid}) is still running`);
  }
  return null;
}

/**
 * Delete the session directory unless {@link purgeBlocker} objects.
 *
 * @param chromePid - The session's Chrome as found before cleanup, or null
 * @param warnings - Warnings from cleanup
 * @returns The deleted directory (undefined if there was none), or the refusal
 */
async function purge(
  chromePid: number | null,
  warnings: string[]
): Promise<{ purged?: string; refusal?: ErrorWithSuggestion }> {
  const refusal = await purgeBlocker(chromePid, warnings);
  if (refusal) return { refusal };
  const purged = purgeSessionDir();
  return purged === undefined ? {} : { purged };
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
 * It does not run the session directory trust check (`secureSessionDir`): it
 * sends no command, only probes the socket and signals PIDs verified by
 * their command line, and must still clean up an untrusted directory.
 *
 * @param opts - Cleanup options
 * @returns Command result
 */
async function cleanupSession(opts: CleanupCommandOptions): Promise<CommandResult<CleanupResult>> {
  const blocker = await cleanupBlocker(opts);
  if (blocker) return blocker;
  const chromePid = opts.purge ? liveSessionChromePid() : null;
  const { cleaned, warnings } = await performSessionCleanup({
    force: Boolean(opts.force) || Boolean(opts.aggressive),
    removeOutput: opts.removeOutput,
  });
  const { purged, refusal } = opts.purge ? await purge(chromePid, warnings) : {};
  if (refusal) {
    return {
      success: false,
      error: refusal.message,
      exitCode: EXIT_CODES.RESOURCE_CONFLICT,
      errorContext: { suggestion: refusal.suggestion },
    };
  }
  const didCleanup = Object.values(cleaned).some(Boolean) || purged !== undefined;
  const downloadsKept = purged === undefined ? keptDownloads() : undefined;
  return {
    success: true,
    data: {
      cleaned,
      ...(purged !== undefined && { purged }),
      ...(downloadsKept && { downloadsKept }),
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
 * Downloaded files of the session, which cleanup keeps.
 *
 * @returns Their directory and count, or undefined when there are none
 */
function keptDownloads(): { dir: string; files: number } | undefined {
  const dir = getSessionDownloadsDir();
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return undefined;
  const files = fs.readdirSync(dir).length;
  return files > 0 ? { dir, files } : undefined;
}

/**
 * Register cleanup command
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Clean up stale session files (downloaded files are kept)')
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
