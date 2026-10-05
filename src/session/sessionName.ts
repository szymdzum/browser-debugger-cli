/**
 * Named sessions (`--session <name>` / `BDG_SESSION`).
 *
 * A named session lives in `<base>/sessions/<name>/` with its own daemon,
 * socket, Chrome and port, so several agents can run bdg side by side.
 */

import { CommandError } from '@/errors/index.js';
import { invalidSessionNameError, sessionNameSocketTooLongError } from '@/errors/messages.js';
import {
  MAX_DAEMON_SOCKET_PATH_BYTES,
  SESSION_NAME_ENV,
  getNamedSessionDir,
  sessionFilePathIn,
} from '@/session/paths.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Longest session name */
export const MAX_SESSION_NAME_LENGTH = 40;

/** Characters allowed in a session name */
const SESSION_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Check a session name: allowed characters, length, and a daemon socket path
 * the OS accepts.
 *
 * @param name - Session name
 * @throws CommandError (81) for an invalid name or a too-long socket path
 */
export function validateSessionName(name: string): void {
  if (!SESSION_NAME_PATTERN.test(name) || name.length > MAX_SESSION_NAME_LENGTH) {
    const err = invalidSessionNameError(name, MAX_SESSION_NAME_LENGTH);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const socketPath = sessionFilePathIn(getNamedSessionDir(name), 'DAEMON_SOCKET');
  if (Buffer.byteLength(socketPath) > MAX_DAEMON_SOCKET_PATH_BYTES) {
    const err = sessionNameSocketTooLongError(name, socketPath, MAX_DAEMON_SOCKET_PATH_BYTES);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
}

/**
 * Select the session the command acts on.
 *
 * `--session` wins over `BDG_SESSION`; the choice is stored in `BDG_SESSION`
 * so the rest of the process (and a daemon it spawns) resolves the same
 * session directory. An empty `BDG_SESSION` means the default session.
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
  process.env[SESSION_NAME_ENV] = name;
}
