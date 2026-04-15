import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Print a validation error in the format matching the command's output mode
 * and exit with the appropriate code.
 *
 * For `CommandError`, emits either a JSON envelope (when `json=true`) or
 * a human-readable message + suggestion, then exits with the error's own
 * exit code. For anything else, prints the message and exits with
 * `INVALID_ARGUMENTS`.
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
      console.log(JSON.stringify(OutputBuilder.buildJsonError(error.message, errorOptions)));
    } else {
      console.error(error.message);
      if (error.metadata.suggestion) console.error(error.metadata.suggestion);
    }
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT_CODES.INVALID_ARGUMENTS);
}
