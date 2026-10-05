import { CommandError } from '@/errors/index.js';
import { genericError } from '@/errors/messages.js';
import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { escapeControlChars } from '@/ui/formatting.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Print a validation error in the format matching the command's output mode
 * and exit with the appropriate code.
 *
 * For `CommandError`, emits either a JSON envelope (when `json=true`) or
 * a human-readable message + suggestion, then exits with the error's own
 * exit code. For anything else, prints the message (as an envelope with
 * `--json`) and exits with `INVALID_ARGUMENTS`.
 *
 * @param error - Error thrown from validation code
 * @param json - Whether the caller is in `--json` output mode
 */
export function handleValidationError(error: unknown, json: boolean): never {
  if (error instanceof CommandError) {
    if (json) {
      const errorOptions: { exitCode: number; suggestion?: string } = {
        exitCode: error.exitCode,
      };
      if (error.metadata.suggestion) {
        errorOptions.suggestion = error.metadata.suggestion;
      }
      console.log(
        JSON.stringify(OutputBuilder.buildJsonError(error.message, errorOptions), null, 2)
      );
    } else {
      console.error(genericError(error.message));
      if (error.metadata.suggestion) console.error(escapeControlChars(error.metadata.suggestion));
    }
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    const envelope = OutputBuilder.buildJsonError(message, {
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    });
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.error(genericError(message));
  }
  process.exit(EXIT_CODES.INVALID_ARGUMENTS);
}
