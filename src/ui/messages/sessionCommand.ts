/**
 * bdg command lines and wording for the selected session.
 *
 * Every hint, suggestion and error that tells the user to run a bdg command
 * goes through {@link sessionCommand}, so a named session's hints carry
 * `--session <name>` and following them never acts on the default session.
 */

import { getSessionName } from '@/session/paths.js';

/**
 * A bdg command for the selected session: ` --session <name>` is appended
 * when a named session is selected.
 *
 * @param command - Command line, e.g. `bdg stop`
 * @param session - Session name (defaults to the selected one; null for the default session)
 * @returns The command, scoped to the session
 *
 * @example
 * ```typescript
 * sessionCommand('bdg stop');            // 'bdg stop' (default session)
 * sessionCommand('bdg stop', 'agent-1'); // 'bdg stop --session agent-1'
 * ```
 */
export function sessionCommand(command: string, session: string | null = getSessionName()): string {
  return session === null ? command : `${command} --session ${session}`;
}

/**
 * "No active session", naming a named session.
 *
 * @param session - Session name (defaults to the selected one; null for the default session)
 * @returns `No active session` or `No active session "<name>"`
 */
export function noActiveSessionMessage(session: string | null = getSessionName()): string {
  return session === null ? 'No active session' : `No active session "${session}"`;
}

/**
 * Shell command that deletes a directory by hand (single-quoted).
 *
 * @param dir - Directory
 * @returns Command line
 */
export function removeDirCommand(dir: string): string {
  return `rm -rf '${dir.replaceAll("'", "'\\''")}'`;
}

/**
 * How to start the selected session.
 *
 * @returns Suggestion
 */
export function startSessionSuggestion(): string {
  return `Start a session with: ${sessionCommand('bdg <url>')}`;
}
