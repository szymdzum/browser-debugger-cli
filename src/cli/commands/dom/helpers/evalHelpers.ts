import type { CDPConnection } from '@/connection/cdp.js';
import { readSessionMetadata, type SessionMetadata } from '@/session/metadata.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { handleCommandErrorWithContext } from './errorHandler.js';

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
 * @param json - Whether to output JSON format
 * @returns PID of running session
 * @throws \{never\} Exits process if no active session found
 */
export function validateActiveSession(json: boolean): number {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    handleCommandErrorWithContext(
      'No active session running',
      json,
      { suggestion: 'Start a session with: bdg <url>' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return pid;
}

/**
 * Get session metadata with validation
 *
 * @param json - Whether to output JSON format
 * @returns Session metadata including targetId and webSocketDebuggerUrl
 * @throws \{never\} Exits process if metadata is invalid or missing required fields
 */
export function getValidatedSessionMetadata(json: boolean): SessionMetadata {
  const metadata = readSessionMetadata();

  if (!metadata?.targetId || !metadata.webSocketDebuggerUrl) {
    handleCommandErrorWithContext(
      'No target information in session metadata',
      json,
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
 * @param json - Whether to output JSON format
 * @throws \{Error\} When CDP response is invalid
 * @throws \{never\} Exits process if target not found
 */
export async function verifyTargetExists(
  metadata: SessionMetadata,
  port: number,
  json: boolean
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targetsData: unknown = await response.json();

  if (!Array.isArray(targetsData)) {
    throw new Error('Invalid response from CDP');
  }

  const target = (targetsData as CDPTarget[]).find((t) => t.id === metadata.targetId);

  if (!target) {
    handleCommandErrorWithContext(
      'Session target not found (tab may have been closed)',
      json,
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
 * @throws \{Error\} When script execution throws exception
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
