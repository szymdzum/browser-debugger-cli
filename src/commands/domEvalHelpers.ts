import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { readSessionMetadata, type SessionMetadata } from '@/session/metadata.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import type { CDPTarget } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import { invalidCDPResponseError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Type guard to validate CDP Runtime.evaluate response structure
 *
 * @param value - Value to check
 * @returns True if value is a valid Protocol.Runtime.EvaluateResponse
 */
function isRuntimeEvaluateResult(value: unknown): value is Protocol.Runtime.EvaluateResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Must have either result or exceptionDetails (or both)
  if (!('result' in obj) && !('exceptionDetails' in obj)) {
    return false;
  }

  // Validate exceptionDetails structure if present
  if ('exceptionDetails' in obj) {
    const exceptionDetails = obj['exceptionDetails'];
    if (typeof exceptionDetails !== 'object' || exceptionDetails === null) {
      return false;
    }

    const details = exceptionDetails as Record<string, unknown>;
    if ('exception' in details) {
      const exception = details['exception'];
      if (typeof exception !== 'object' || exception === null) {
        return false;
      }

      const exObj = exception as Record<string, unknown>;
      if ('description' in exObj && typeof exObj['description'] !== 'string') {
        return false;
      }
    }
  }

  // Validate result structure if present
  if ('result' in obj) {
    const result = obj['result'];
    if (typeof result !== 'object' || result === null) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that an active session is running
 *
 * @returns PID of running session
 * @throws Error When no active session is found
 */
export function validateActiveSession(): number {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    throw new CommandError(
      'No active session running',
      { suggestion: 'Start a session with: bdg <url>' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return pid;
}

/**
 * Get session metadata with validation
 *
 * @returns Session metadata including targetId and webSocketDebuggerUrl
 * @throws Error When metadata is invalid or missing required fields
 */
export function getValidatedSessionMetadata(): SessionMetadata {
  const metadata = readSessionMetadata();

  if (!metadata?.targetId || !metadata.webSocketDebuggerUrl) {
    throw new CommandError(
      'No target information in session metadata',
      { note: 'Session may have been started with an older version' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }

  return metadata;
}

/**
 * Verify that the CDP target still exists
 *
 * @param metadata - Session metadata containing targetId
 * @param port - CDP port number
 * @throws Error When CDP response is invalid or target not found
 */
export async function verifyTargetExists(metadata: SessionMetadata, port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targetsData: unknown = await response.json();

  if (!Array.isArray(targetsData)) {
    throw new Error(invalidCDPResponseError());
  }

  const target = (targetsData as CDPTarget[]).find((t) => t.id === metadata.targetId);

  if (!target) {
    throw new CommandError(
      'Session target not found (tab may have been closed)',
      { suggestion: 'Start a new session with: bdg <url>' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
}

/**
 * Execute JavaScript in browser context via CDP
 *
 * @param cdp - CDP connection instance
 * @param script - JavaScript expression to execute
 * @returns Execution result
 * @throws Error When script execution throws exception or returns invalid response
 */
export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<Protocol.Runtime.EvaluateResponse> {
  const response = await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  });

  // Validate response structure at runtime
  if (!isRuntimeEvaluateResult(response)) {
    throw new CommandError(
      'Invalid CDP Runtime.evaluate response structure',
      {
        note: 'CDP response did not match expected format',
        suggestion: 'This may indicate a CDP protocol version mismatch',
      },
      EXIT_CODES.CDP_CONNECTION_FAILURE
    );
  }

  // Check for execution exceptions
  if (response.exceptionDetails) {
    const errorMsg =
      response.exceptionDetails.exception?.description ?? 'Unknown error executing script';
    throw new Error(errorMsg);
  }

  return response;
}
