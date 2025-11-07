import type { CDPConnection } from '@/connection/cdp.js';
import { readSessionMetadata, type SessionMetadata } from '@/session/metadata.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import { CommandError } from '@/ui/errors/index.js';
import { invalidCDPResponseError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * CDP target information
 */
interface CDPTarget {
  id: string;
}

/**
 * CDP Runtime.evaluate result
 */
interface RuntimeEvaluateResult {
  exceptionDetails?: {
    exception?: {
      description?: string;
    };
  };
  result?: {
    value?: unknown;
  };
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
 * @throws Error When script execution throws exception
 */
export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<RuntimeEvaluateResult> {
  const result = (await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  })) as RuntimeEvaluateResult;

  // Check for execution exceptions
  if (result.exceptionDetails) {
    const errorMsg =
      result.exceptionDetails.exception?.description ?? 'Unknown error executing script';
    throw new Error(errorMsg);
  }

  return result;
}
