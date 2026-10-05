/**
 * Named sessions (`--session <name>` / `BDG_SESSION`).
 *
 * A named session lives in `<base>/sessions/<name>/` with its own daemon,
 * socket, Chrome and port, so several agents can run bdg side by side.
 * Names are case-insensitive: they are lower-cased when selected, so `ALPHA`
 * and `alpha` are the same session (and directory) on every file system.
 */

import { CommandError } from '@/errors/index.js';
import {
  invalidSessionNameError,
  sessionNameSocketTooLongError,
  socketPathTooLongError,
} from '@/errors/messages.js';
import {
  MAX_DAEMON_SOCKET_PATH_BYTES,
  SESSION_NAME_ENV,
  getNamedSessionDir,
  sessionFilePathIn,
} from '@/session/paths.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Longest session name */
export const MAX_SESSION_NAME_LENGTH = 40;

/**
 * Characters allowed in a session name: a letter or digit first (so a name
 * never looks like an option), then letters, digits, `-` or `_`.
 */
const SESSION_NAME_PATTERN = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,${MAX_SESSION_NAME_LENGTH - 1}}$`
);

/**
 * Whether a name has the allowed characters and length (case-insensitive).
 *
 * @param name - Session name
 * @returns True for a valid name
 */
export function isValidSessionName(name: string): boolean {
  return SESSION_NAME_PATTERN.test(name);
}

/**
 * The canonical form of a session name: lower case.
 *
 * @param name - Session name as given
 * @returns Lower-cased name
 */
export function normalizeSessionName(name: string): string {
  return name.toLowerCase();
}

/**
 * Check a session name: allowed characters, length, and a daemon socket path
 * the OS accepts. When even the shortest name would make the socket path too
 * long, the base directory is blamed instead of the name.
 *
 * @param name - Session name
 * @throws CommandError (81) for an invalid name or a too-long socket path
 */
export function validateSessionName(name: string): void {
  if (!isValidSessionName(name)) {
    throwInvalid(invalidSessionNameError(name, MAX_SESSION_NAME_LENGTH));
  }
  const shortest = namedSocketPath('a');
  if (Buffer.byteLength(shortest) > MAX_DAEMON_SOCKET_PATH_BYTES) {
    throwInvalid(socketPathTooLongError(shortest, MAX_DAEMON_SOCKET_PATH_BYTES));
  }
  const socketPath = namedSocketPath(name);
  if (Buffer.byteLength(socketPath) > MAX_DAEMON_SOCKET_PATH_BYTES) {
    throwInvalid(sessionNameSocketTooLongError(name, socketPath, MAX_DAEMON_SOCKET_PATH_BYTES));
  }
}

/**
 * Daemon socket path of a named session.
 *
 * @param name - Session name
 * @returns Socket path
 */
function namedSocketPath(name: string): string {
  return sessionFilePathIn(getNamedSessionDir(name), 'DAEMON_SOCKET');
}

/**
 * Throw an invalid-arguments error (81).
 *
 * @param err - Message and suggestion
 * @throws CommandError always
 */
function throwInvalid(err: { message: string; suggestion: string }): never {
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Select the session the command acts on.
 *
 * `--session` wins over `BDG_SESSION`; the choice is stored in `BDG_SESSION`
 * so the rest of the process (and a daemon it spawns) resolves the same
 * session directory. The name is stored lower-cased. An empty `BDG_SESSION`
 * means the default session.
 *
 * @param optionValue - Value of `--session`, if given
 * @throws CommandError (81) for an invalid name
 */
export function selectSession(optionValue: string | undefined): void {
  const name = optionValue ?? process.env[SESSION_NAME_ENV]?.trim();
  if (name === undefined || (optionValue === undefined && name === '')) {
    delete process.env[SESSION_NAME_ENV];
    return;
  }
  validateSessionName(name);
  process.env[SESSION_NAME_ENV] = normalizeSessionName(name);
}
