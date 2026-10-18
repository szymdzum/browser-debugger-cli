/**
 * Start option, session name and session directory error messages.
 */

import * as os from 'os';
import * as path from 'path';

import type { UntrustedSessionDir } from '@/session/paths.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { type ErrorWithSuggestion } from './shared.js';

/**
 * Start options given without the URL to open.
 */
export function missingStartUrlError(): ErrorWithSuggestion {
  return {
    message: 'Missing URL to open',
    suggestion: 'Put the URL first, e.g. bdg localhost:3000 --port 9333',
  };
}

/**
 * `--viewport` given something that is not a width and height.
 *
 * @param value - What was given
 * @param max - Largest side accepted
 */
export function invalidViewportError(value: string, max: number): ErrorWithSuggestion {
  return {
    message: `Invalid --viewport: "${value}"`,
    suggestion: `Give width x height in CSS px (1-${max} each), e.g. --viewport 1280x800`,
  };
}

/**
 * `--color-scheme` given another value than the ones it takes.
 *
 * @param value - What was given
 * @param similar - Close matches
 * @param schemes - Accepted values
 */
export function invalidColorSchemeError(
  value: string,
  similar: string[],
  schemes: readonly string[]
): ErrorWithSuggestion {
  return {
    message: `Unknown --color-scheme: "${value}"`,
    suggestion: similar[0] ? `Did you mean: ${similar[0]}?` : `Available: ${schemes.join(', ')}`,
  };
}

/**
 * `--dialog` given something other than accept or dismiss.
 *
 * @param value - What was given
 * @param similar - Answers close to it, closest first
 * @param answers - Valid answers
 */
export function invalidDialogAnswerError(
  value: string,
  similar: string[],
  answers: readonly string[]
): ErrorWithSuggestion {
  return {
    message: `Unknown --dialog: "${value}"`,
    suggestion: similar[0] ? `Did you mean: ${similar[0]}?` : `Available: ${answers.join(', ')}`,
  };
}

/**
 * `-u` / `--user-data-dir` given something that is not a directory path.
 *
 * @param value - What was given
 * @param reason - Why it cannot be used
 */
export function invalidUserDataDirError(value: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Invalid --user-data-dir "${value}": ${reason}`,
    suggestion:
      'Give a directory for the Chrome profile, e.g. -u ./profile (it is created if missing)',
  };
}

/**
 * A `--session` / `BDG_SESSION` name bdg cannot use as a directory name.
 *
 * @param name - The rejected name
 * @param maxLength - Longest allowed name
 */
export function invalidSessionNameError(name: string, maxLength: number): ErrorWithSuggestion {
  return {
    message: `Invalid session name "${name}"`,
    suggestion: `Use 1-${maxLength} letters, digits, "-" or "_", starting with a letter or digit, e.g. --session agent-1`,
  };
}

/**
 * A session name whose daemon socket path would exceed the OS limit.
 *
 * @param name - Session name
 * @param socketPath - Resulting socket path
 * @param max - Longest socket path in bytes
 */
export function sessionNameSocketTooLongError(
  name: string,
  socketPath: string,
  max: number
): ErrorWithSuggestion {
  return {
    message: `Session name "${name}" makes the daemon socket path too long (${Buffer.byteLength(socketPath)} bytes, at most ${max}): ${socketPath}`,
    suggestion: `Use a shorter session name, or a shorter BDG_SESSION_DIR (e.g. ${privateSessionDirExample()})`,
  };
}

/**
 * `bdg cleanup --purge` without a named session (the default session's
 * directory holds the named sessions).
 */
export function purgeNeedsNamedSessionError(): ErrorWithSuggestion {
  return {
    message: "--purge deletes a named session's directory and needs --session <name>",
    suggestion: 'Name the session: bdg cleanup --session <name> --purge (see bdg sessions)',
  };
}

/**
 * `bdg cleanup --purge` found the session still holding its directory after
 * cleaning up, so the directory is kept.
 *
 * @param dir - Session directory
 * @param reason - What still holds it
 */
export function purgeRefusedError(dir: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Not deleting ${dir}: ${reason}`,
    suggestion: `End the session first (${sessionCommand('bdg cleanup --force')}), then retry: ${sessionCommand('bdg cleanup --purge')}`,
  };
}

/**
 * A short session directory only the user can use, for suggestions: in
 * `$XDG_RUNTIME_DIR` (Linux, private to the user) when set, else a per-user
 * name in the OS temp directory (per-user on macOS). Never the shared
 * `/tmp/bdg`, which another user can create first.
 *
 * @returns Absolute directory path
 */
function privateSessionDirExample(): string {
  const runtimeDir = process.env['XDG_RUNTIME_DIR']?.trim();
  if (runtimeDir) return path.join(runtimeDir, 'bdg');
  const uid = process.getuid?.();
  return path.join(os.tmpdir(), uid === undefined ? 'bdg' : `bdg-${uid}`);
}

/**
 * Fix for an unusable session directory.
 *
 * @returns Suggestion naming a private, short directory
 */
function sessionDirSuggestion(): string {
  return `Set BDG_SESSION_DIR to a short directory only you can write to, e.g. BDG_SESSION_DIR=${privateSessionDirExample()}`;
}

/**
 * The session directory exists but is not a directory.
 *
 * @param dir - Session directory
 */
export function sessionDirIsFileError(dir: string): ErrorWithSuggestion {
  return { message: `Session directory ${dir} is a file`, suggestion: sessionDirSuggestion() };
}

/**
 * The session directory cannot be created or written.
 *
 * @param dir - Session directory
 * @param reason - File-system error
 */
export function sessionDirNotWritableError(dir: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Session directory ${dir} is not writable (${reason})`,
    suggestion: sessionDirSuggestion(),
  };
}

/**
 * The session directory, or one above it, is not safe to use: another user
 * could replace the daemon socket or plant files there.
 *
 * @param untrusted - Untrusted directory and why
 */
export function untrustedSessionDirError(untrusted: UntrustedSessionDir): ErrorWithSuggestion {
  return {
    message: `Session directory ${untrusted.dir} is not safe to use: ${untrusted.reason}`,
    suggestion: untrustedSessionDirSuggestion(untrusted),
  };
}

/**
 * Fix for an untrusted session directory: remove a symlink, use a
 * subdirectory of a shared sticky directory (`BDG_SESSION_DIR=/tmp`), chmod
 * a directory bdg owns (`~/.bdg`, `sessions/`, `sessions/<name>`), else
 * choose another `BDG_SESSION_DIR`.
 *
 * @param untrusted - Untrusted directory and why
 * @returns Suggestion
 */
function untrustedSessionDirSuggestion(untrusted: UntrustedSessionDir): string {
  const { dir, kind, bdgOwned } = untrusted;
  const example = `BDG_SESSION_DIR=${privateSessionDirExample()}`;
  if (kind === 'symlink') {
    return `Remove the link (rm ${dir}) or point BDG_SESSION_DIR at the real directory`;
  }
  if (kind === 'shared') {
    return `${dir} is shared by all users; use a subdirectory only you can write to, e.g. ${example}`;
  }
  if (bdgOwned) return `Run chmod 700 ${dir} (or remove it if it is not yours), then retry`;
  return `Use a directory you own that others cannot write to, e.g. ${example} (or chmod 700 ${dir} if it is yours)`;
}

/**
 * The daemon log cannot be opened for writing (a symlink there is refused,
 * not followed).
 *
 * @param logPath - Daemon log path
 * @param code - File-system error code
 */
export function daemonLogNotOpenedError(logPath: string, code: string): ErrorWithSuggestion {
  return {
    message: `Cannot open the daemon log ${logPath} (${code === 'ELOOP' ? 'it is a symbolic link' : code})`,
    suggestion: `Remove ${logPath} if you did not create it, then retry`,
  };
}

/**
 * The daemon socket path exceeds the OS limit for Unix sockets.
 *
 * @param socketPath - Socket path
 * @param max - Longest path the OS accepts
 */
export function socketPathTooLongError(socketPath: string, max: number): ErrorWithSuggestion {
  return {
    message: `Session directory path is too long for the daemon socket (${Buffer.byteLength(socketPath)} bytes, at most ${max}): ${socketPath}`,
    suggestion: sessionDirSuggestion(),
  };
}
