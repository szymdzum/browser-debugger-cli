/**
 * Session and cleanup messages.
 */

import type { ErrorWithSuggestion } from '@/errors/messages.js';
import {
  buildAgentDiscoveryHelp,
  buildCommonTaskExamples,
  buildUrlExamples,
  buildSessionManagementReminder,
} from '@/ui/formatters/helpFormatters.js';
import { joinLines, pluralize } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { pageCrashedNote } from './shared.js';

/**
 * Chrome closed by `bdg stop` (gracefully, so the profile is saved).
 *
 * @param pid - Chrome process ID
 * @returns Formatted success message
 */
export function chromeClosedMessage(pid?: number): string {
  return pid ? `Closed Chrome (PID ${pid})` : 'Closed Chrome';
}

/**
 * Generate orphaned daemons cleaned message.
 *
 * @param count - Number of orphaned daemons cleaned up
 * @returns Formatted success message
 */
export function orphanedDaemonsCleanedMessage(count: number): string {
  return `Cleaned up ${count} orphaned daemon process${count === 1 ? '' : 'es'}`;
}

/**
 * Where `bdg install-skill` kept the copy it replaced.
 *
 * @param path - Backup path, as the user would type it
 * @returns One line
 */
export function skillBackupMessage(path: string): string {
  return `previous copy kept in ${path}`;
}

/**
 * The `prefers-color-scheme` media feature the page sees, labelled as the
 * preference it is (the page may still render its own theme), and where it
 * comes from.
 *
 * @param scheme - Light or dark
 * @param emulated - Set with `--color-scheme` or `page emulate` (otherwise the system setting)
 * @returns e.g. `prefers-color-scheme: dark (from the system setting)`
 */
export function colorSchemeLabel(scheme: string, emulated: boolean): string {
  const source = emulated ? 'emulated' : 'from the system setting';
  return `prefers-color-scheme: ${scheme} (${source})`;
}

/**
 * Put the page-crashed warning before a view of collected data, when the
 * page crashed (what is shown was collected before).
 *
 * @param body - The view
 * @param crashedAt - When the page crashed (epoch ms), if it did
 * @returns The view, after the warning when the page crashed
 */
export function withPageCrashedNote(body: string, crashedAt: number | undefined): string {
  return crashedAt === undefined ? body : `${pageCrashedNote(crashedAt)}\n\n${body}`;
}

/**
 * Generate session files cleaned up message.
 *
 * @returns Formatted success message
 */
export function sessionFilesCleanedMessage(): string {
  return 'Session files cleaned up';
}

/**
 * Cleanup left the session's downloaded files in place.
 *
 * @param dir - Downloads directory
 * @param files - Files in it
 * @returns e.g. `Downloads kept: 2 files in /Users/me/.bdg/downloads (delete them yourself when done)`
 */
export function downloadsKeptMessage(dir: string, files: number): string {
  return `Downloads kept: ${pluralize(files, 'file')} in ${dir} (delete them yourself when done)`;
}

/**
 * Cleanup finished and left nothing behind.
 *
 * @returns Message
 */
export function sessionDirectoryCleanMessage(): string {
  return 'Session directory is now clean';
}

/**
 * `bdg cleanup --purge` deleted a named session's directory.
 *
 * @param dir - Deleted directory
 * @returns Message
 */
export function sessionDirectoryPurgedMessage(dir: string): string {
  return `Session directory removed: ${dir}`;
}

/**
 * Generate no session files found message.
 *
 * @returns Formatted success message
 */
export function noSessionFilesMessage(): string {
  return 'No session files found. Session directory is already clean';
}

/**
 * Generate session still active error.
 *
 * @param pid - Active process ID
 * @returns Formatted error message
 */
export function sessionStillActiveError(pid: number): string {
  return `Session is still active (PID ${pid})`;
}

/**
 * How to clean up a session that is still running.
 *
 * @param session - Name of a named session, or null for the default session
 * @returns Suggestion lines
 */
export function sessionStillActiveSuggestion(session: string | null): string {
  return `Stop gracefully: ${sessionCommand('bdg stop', session)}\nForce cleanup: ${sessionCommand('bdg cleanup --force', session)}`;
}

/**
 * Generate help message when no URL is provided to start command.
 *
 * Displays comprehensive guidance optimized for agent discovery:
 * - Agent-specific resources (machine-readable schema, CDP discovery)
 * - Complete task workflow examples
 * - URL format guidance
 * - Session management commands
 *
 * Organized to prioritize agent needs (discovery first) while maintaining
 * human readability with clear task-oriented examples.
 *
 * @returns Multi-line help message with examples
 * */
export function startCommandHelpMessage(): string {
  return joinLines(
    '',
    buildAgentDiscoveryHelp(),
    '',
    buildCommonTaskExamples(),
    '',
    buildUrlExamples(),
    '',
    buildSessionManagementReminder(),
    '',
    'Not sure which command? Start a session to see all available commands:',
    '  bdg <url>',
    ''
  );
}

/**
 * The CLI bundle failed to load (missing, or broken by a partial install).
 *
 * @param file - Path of the CLI bundle
 * @returns Message and suggestion
 */
export function cliLoadFailedError(file: string): ErrorWithSuggestion {
  return {
    message: `The bdg CLI failed to load (${file})`,
    suggestion: 'Reinstall bdg: npm install -g browser-debugger-cli',
  };
}

/**
 * Warning for an old spelling that still works until 1.0 (#465).
 *
 * @param oldSpelling - Old spelling (`bdg tail`)
 * @param instead - What to do instead (`use "bdg peek --follow"`)
 * @returns Warning text (without the `Warning:` prefix)
 */
export function deprecatedNameWarning(oldSpelling: string, instead: string): string {
  return `"${oldSpelling}" is deprecated and will be removed in 1.0: ${instead}`;
}
