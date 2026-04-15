import {
  getValidatedSessionMetadata,
  validateActiveSession,
  verifyTargetExists,
} from '@/commands/dom/evalHelpers.js';
import { CDPConnection } from '@/connection/cdp.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { CommandError } from '@/ui/errors/index.js';
import { sessionMetadataMissingError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Run a callback with a direct CDP connection to the active session's target.
 *
 * Validates the session, verifies the target, opens a CDP WebSocket,
 * invokes the callback, and guarantees the connection is closed afterwards.
 *
 * NOTE: This bridge exists because some DOM operations (form fill/click/submit,
 * dom eval) need event-driven sequences that are not currently supported by the
 * daemon's IPC `callCDP` interface. Prefer routing through `callCDP` when
 * possible. See issue #216 for the planned full migration.
 *
 * @param fn - Callback that receives an open CDP connection and the session metadata
 * @returns Whatever the callback returns
 * @throws CommandError if session metadata is missing required fields
 */
export async function withCDPConnection<T>(
  fn: (cdp: CDPConnection, metadata: SessionMetadata) => Promise<T>
): Promise<T> {
  validateActiveSession();
  const metadata = getValidatedSessionMetadata();

  if (!metadata.port) {
    throw new CommandError(
      'Session metadata missing port',
      { suggestion: 'Restart the session with: bdg stop && bdg <url>' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }

  if (!metadata.webSocketDebuggerUrl) {
    const err = sessionMetadataMissingError('webSocketDebuggerUrl');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }

  await verifyTargetExists(metadata, metadata.port);

  const cdp = new CDPConnection();
  await cdp.connect(metadata.webSocketDebuggerUrl);

  try {
    return await fn(cdp, metadata);
  } finally {
    cdp.close();
  }
}
