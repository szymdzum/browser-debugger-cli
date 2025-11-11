import { OutputBuilder } from '@/commands/shared/OutputBuilder.js';
import { CommandError, getErrorMessage, isDaemonConnectionError } from '@/ui/errors/index.js';
import { daemonNotRunningError, unknownError, genericError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Standard options supported by CommandRunner.
 * All commands that use CommandRunner must extend this interface.
 */
export interface BaseCommandOptions {
  /** Output as JSON instead of human-readable format */
  json?: boolean;
}

/**
 * Result from a command handler.
 * Handler functions should return this structure to indicate success/failure.
 */
export interface CommandResult<T = unknown> {
  /** Whether the command succeeded */
  success: boolean;
  /** Data to output (for successful commands) */
  data?: T;
  /** Error message (for failed commands) */
  error?: string;
  /** Optional exit code override (defaults: SUCCESS=0, error codes from EXIT_CODES) */
  exitCode?: number;
}

/**
 * Handler function type.
 * Command logic should be implemented as a function matching this signature.
 */
export type CommandHandler<TOptions extends BaseCommandOptions, TResult = unknown> = (
  options: TOptions
) => Promise<CommandResult<TResult>>;

/**
 * Formatter function type for human-readable output.
 * Receives the command result data and returns a formatted string.
 *
 * @returns Formatted string to be output to console
 */
export type CommandFormatter<TResult = unknown> = (data: TResult) => string;

/**
 * Run a command with consistent error handling, output formatting, and exit codes.
 * Eliminates boilerplate try-catch and JSON output logic from command handlers.
 *
 * This helper:
 * - Wraps command logic in try-catch
 * - Handles IPC connection errors (ENOENT, ECONNREFUSED)
 * - Formats output as JSON or human-readable based on --json flag
 * - Calls process.exit() with appropriate exit code
 *
 * @param handler - Command logic that returns CommandResult or throws
 * @param options - Command options (must include json flag)
 * @param formatter - Optional human-readable formatter (if not provided, outputs raw JSON)
 *
 * @example
 * ```typescript
 * await runCommand(
 *   async (opts) => {
 *     const data = await fetchData(opts.url);
 *     return { success: true, data };
 *   },
 *   options,
 *   formatData
 * );
 * ```
 */
export async function runCommand<TOptions extends BaseCommandOptions, TResult = unknown>(
  handler: CommandHandler<TOptions, TResult>,
  options: TOptions,
  formatter?: CommandFormatter<TResult>
): Promise<void> {
  try {
    const result = await handler(options);

    if (!result.success) {
      // Error result from handler
      if (options.json) {
        console.log(
          JSON.stringify(OutputBuilder.buildJsonError(result.error ?? 'Unknown error'), null, 2)
        );
      } else {
        console.error(result.error ? genericError(result.error) : unknownError());
      }
      process.exit(result.exitCode ?? EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    // Success - output data
    if (options.json) {
      console.log(JSON.stringify(result.data, null, 2));
    } else if (formatter) {
      const formattedOutput = formatter(result.data as TResult);
      console.log(formattedOutput);
    } else {
      // Fallback: JSON output if no formatter provided
      console.log(JSON.stringify(result.data, null, 2));
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    // Handle CommandError with metadata and custom exit code
    if (error instanceof CommandError) {
      if (options.json) {
        console.log(
          JSON.stringify(OutputBuilder.buildJsonError(error.message, error.metadata), null, 2)
        );
      } else {
        console.error(genericError(error.message));
        // Output metadata as additional help text
        for (const value of Object.values(error.metadata)) {
          console.error(value);
        }
      }
      process.exit(error.exitCode);
    }

    const errorMessage = getErrorMessage(error);

    // Detect daemon connection errors
    if (isDaemonConnectionError(error)) {
      if (options.json) {
        console.log(
          JSON.stringify(
            OutputBuilder.buildJsonError('Daemon not running', {
              suggestion: 'Start it with: bdg <url>',
            }),
            null,
            2
          )
        );
      } else {
        console.error(daemonNotRunningError());
      }
      process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
    }

    // Generic error
    if (options.json) {
      console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMessage), null, 2));
    } else {
      console.error(genericError(errorMessage));
    }
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}
