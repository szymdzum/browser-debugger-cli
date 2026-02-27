import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { readSessionMetadata, type SessionMetadata } from '@/session/metadata.js';
import { readPid } from '@/session/pid.js';
import { CommandError } from '@/ui/errors/index.js';
import {
  sessionNotActiveError,
  sessionMetadataMissingError,
  sessionTargetNotFoundError,
  scriptExecutionError,
} from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { fetchCDPTargetById } from '@/utils/http.js';
import { isProcessAlive } from '@/utils/process.js';

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

  if (!('result' in obj) && !('exceptionDetails' in obj)) {
    return false;
  }

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
 * @throws CommandError When no active session is found
 */
export function validateActiveSession(): number {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    throw new CommandError(
      sessionNotActiveError('execute DOM operations'),
      {},
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
    const err = sessionMetadataMissingError('targetId or webSocketDebuggerUrl');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }

  return metadata;
}

/**
 * Verify that the CDP target still exists
 *
 * Uses the centralized fetchCDPTargetById utility which includes timeout
 * safeguards and consistent error handling.
 *
 * @param metadata - Session metadata containing targetId
 * @param port - CDP port number
 * @throws CommandError When target not found (tab may have been closed)
 */
export async function verifyTargetExists(metadata: SessionMetadata, port: number): Promise<void> {
  if (!metadata.targetId) {
    const err = sessionMetadataMissingError('targetId');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  const target = await fetchCDPTargetById(metadata.targetId, port);

  if (!target) {
    const err = sessionTargetNotFoundError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
}

/**
 * Execute JavaScript in browser context via CDP
 *
 * Handles non-serializable results (like DOM nodes) gracefully by returning
 * a description instead of failing with "Object reference chain is too long".
 *
 * @param cdp - CDP connection instance
 * @param script - JavaScript expression to execute
 * @returns Execution result with value or description for non-serializable objects
 * @throws Error When script execution throws exception or returns invalid response
 */
export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<Protocol.Runtime.EvaluateResponse> {
  // First try without returnByValue to safely get result type
  const response = await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: false,
    awaitPromise: true,
  });

  if (!isRuntimeEvaluateResult(response)) {
    throw new CommandError(
      'Invalid CDP Runtime.evaluate response structure',
      {
        suggestion:
          'CDP response did not match expected format. This may indicate a CDP protocol version mismatch',
      },
      EXIT_CODES.CDP_CONNECTION_FAILURE
    );
  }

  if (response.exceptionDetails) {
    const errorMsg =
      response.exceptionDetails.exception?.description ?? 'Unknown error executing script';
    const err = scriptExecutionError(errorMsg, script);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }

  const result = response.result as Protocol.Runtime.RemoteObject | undefined;
  if (!result) {
    return response;
  }

  // For DOM nodes, return description since they can't be serialized
  if (result.subtype === 'node') {
    return {
      ...response,
      result: {
        ...result,
        value: result.description ?? `[${result.className ?? 'Node'}]`,
      },
    };
  }

  // For primitives and simple types, CDP already provides the value
  const primitiveTypes = ['string', 'number', 'boolean', 'undefined'];
  if (primitiveTypes.includes(result.type) || result.subtype === 'null') {
    return {
      ...response,
      result: {
        ...result,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        value: result.value,
      },
    };
  }

  // For objects/arrays, try to serialize with returnByValue
  try {
    const serializedResponse = await cdp.send('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });

    if (isRuntimeEvaluateResult(serializedResponse) && !serializedResponse.exceptionDetails) {
      return serializedResponse;
    }
  } catch {
    // Serialization failed, fall through to description
  }

  // Return description for complex objects that can't be serialized
  return {
    ...response,
    result: {
      ...result,
      value: result.description ?? `[${result.className ?? result.type}]`,
    },
  };
}
