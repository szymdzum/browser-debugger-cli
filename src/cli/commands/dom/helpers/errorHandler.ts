import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Handle command errors with consistent formatting
 *
 * Outputs error message in JSON or human-readable format and exits with error code.
 * This function never returns - it always calls process.exit().
 *
 * @param error - Error object or message
 * @param json - Whether to output JSON format
 * @param exitCode - Exit code to use (defaults to UNHANDLED_EXCEPTION)
 * @throws {never} This function always exits the process
 *
 * @example
 * try {
 *   await someOperation();
 * } catch (error) {
 *   handleCommandError(error, options.json);
 * }
 */
export function handleCommandError(
  error: unknown,
  json: boolean,
  exitCode: number = EXIT_CODES.UNHANDLED_EXCEPTION
): never {
  const errorMsg = getErrorMessage(error);
  if (json) {
    console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
  } else {
    console.error(`Error: ${errorMsg}`);
  }
  process.exit(exitCode);
}

/**
 * Handle command errors with additional context
 *
 * Similar to handleCommandError but allows adding suggestion or note metadata
 * to JSON error output for better user guidance.
 *
 * @param error - Error object or message
 * @param json - Whether to output JSON format
 * @param metadata - Additional context (suggestion, note, etc.)
 * @param exitCode - Exit code to use (defaults to UNHANDLED_EXCEPTION)
 * @throws {never} This function always exits the process
 *
 * @example
 * handleCommandErrorWithContext(
 *   'Session not found',
 *   options.json,
 *   { suggestion: 'Start a session with: bdg <url>' },
 *   EXIT_CODES.RESOURCE_NOT_FOUND
 * );
 */
export function handleCommandErrorWithContext(
  error: unknown,
  json: boolean,
  metadata: Record<string, string>,
  exitCode: number = EXIT_CODES.UNHANDLED_EXCEPTION
): never {
  const errorMsg = getErrorMessage(error);
  if (json) {
    console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg, metadata), null, 2));
  } else {
    console.error(`Error: ${errorMsg}`);
    // Output metadata as additional help text
    for (const value of Object.values(metadata)) {
      console.error(`${value}`);
    }
  }
  process.exit(exitCode);
}
