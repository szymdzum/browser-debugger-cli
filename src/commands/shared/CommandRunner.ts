import { type BaseOptions } from '@/commands/shared/optionTypes.js';
import { getQuickIPCRequestTimeout } from '@/constants.js';
import { CommandError, isDaemonConnectionError } from '@/errors/index.js';
import {
  daemonNotRunningError,
  unknownError,
  genericError,
  commandTimedOutError,
  sessionNotRespondingError,
  sessionEndedDuringCommandError,
} from '@/errors/messages.js';
import { IPCEarlyCloseError, IPCTimeoutError } from '@/ipc/transport/IPCError.js';
import { takeTabMove } from '@/ipc/utils/tabMove.js';
import { OutputBuilder, buildSuccessResponse, stringifyEnvelope } from '@/ui/OutputBuilder.js';
import { escapeControlChars } from '@/ui/formatting.js';
import { tabClosedText } from '@/ui/messages/commands.js';
import { noActiveSessionMessage, startSessionSuggestion } from '@/ui/messages/sessionCommand.js';
import { getErrorExitCode, getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

export type { BaseOptions };

/**
 * The error every command gives when there is no session to talk to.
 *
 * @returns Command error (exit 83) with how to start one
 */
export function noActiveSessionError(): CommandError {
  return new CommandError(
    noActiveSessionMessage(),
    { suggestion: startSessionSuggestion() },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * Execute an async function and output JSON result with proper error handling.
 *
 * Use this for early JSON exits when runCommand's formatter isn't needed.
 * Handles errors consistently, outputting `{ success: false, error: "..." }` on failure.
 *
 * @param fn - Async function that returns data to serialize
 *
 * @example
 * ```typescript
 * if (options.json) {
 *   await runJsonCommand(async () => {
 *     const data = await fetchData();
 *     return data;
 *   });
 * }
 * ```
 */
export async function runJsonCommand<T>(fn: () => Promise<T>): Promise<never> {
  try {
    const data = await fn();
    console.log(stringifyEnvelope(withTabMove(buildSuccessResponse(data))));
    process.exit(EXIT_CODES.SUCCESS);
  } catch (caught) {
    const error = isDaemonConnectionError(caught)
      ? noActiveSessionError()
      : caught instanceof IPCTimeoutError
        ? timeoutError(caught)
        : caught;
    const exitCode = getErrorExitCode(error, EXIT_CODES.UNHANDLED_EXCEPTION);
    const suggestion =
      error instanceof CommandError && typeof error.metadata['suggestion'] === 'string'
        ? error.metadata['suggestion']
        : undefined;
    console.log(
      stringifyEnvelope(
        withTabMove(
          OutputBuilder.buildJsonError(getErrorMessage(error), {
            exitCode,
            ...(suggestion && { suggestion }),
          })
        )
      )
    );
    process.exit(exitCode);
  }
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
  /** Optional error context (suggestions, examples, etc.) */
  errorContext?: Record<string, unknown>;
  /** Optional hint message to display on stderr (for successful commands with guidance) */
  hint?: string;
  /**
   * Print the formatter's text as it is, for piping: no newline added, and
   * control characters escaped only when stdout is a terminal
   */
  raw?: boolean;
  /**
   * Warning about how the command ran (success or failure): top-level
   * `warning` in the JSON envelope, `Warning: …` on stderr otherwise
   */
  warning?: string;
}

/**
 * Handler function type.
 * Command logic should be implemented as a function matching this signature.
 */
export type CommandHandler<TOptions extends BaseOptions, TResult = unknown> = (
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
 * An IPC timeout as a user-facing error (exit 102): a quick request (status,
 * peek, the handshake before page work) means the session is not responding;
 * a long one means the command itself did not finish.
 *
 * @param error - IPC timeout
 * @returns Command error with a way out
 */
export function timeoutError(error: IPCTimeoutError): CommandError {
  const seconds = error.timeoutMs / 1000;
  const err =
    error.timeoutMs <= getQuickIPCRequestTimeout()
      ? sessionNotRespondingError(seconds)
      : commandTimedOutError(seconds);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
}

/**
 * The daemon closed the connection before answering: the session ended.
 *
 * @returns Command error (83)
 */
function sessionEndedError(): CommandError {
  const err = sessionEndedDuringCommandError();
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * Add a move of the session to another tab that a daemon response of this
 * command carried (its tab closed on its own and no command reported it
 * yet) to a `--json` envelope: top-level `tabClosed` and `switchedTo`.
 *
 * @param envelope - Response envelope
 * @returns The envelope, with the move when there was one
 */
function withTabMove<T extends object>(envelope: T): T {
  const moved = takeTabMove();
  return moved ? { ...envelope, ...moved } : envelope;
}

/**
 * Print a move of the session to another tab that a daemon response of this
 * command carried on stderr (text output), unless the text shown already
 * says it (an action refused because of it).
 *
 * @param shown - Text already printed
 */
function printTabMove(shown = ''): void {
  const moved = takeTabMove();
  if (!moved) return;
  const line = tabClosedText(moved.tabClosed, moved.switchedTo);
  if (!shown.includes(line)) console.error(escapeControlChars(line));
}

/**
 * Print a command's warning on stderr (text output; `--json` has it in the envelope).
 *
 * @param warning - Warning, if any
 */
function printWarning(warning: string | undefined): void {
  if (warning) console.error(escapeControlChars(`Warning: ${warning}`));
}

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
export async function runCommand<TOptions extends BaseOptions, TResult = unknown>(
  handler: CommandHandler<TOptions, TResult>,
  options: TOptions,
  formatter?: CommandFormatter<TResult>
): Promise<void> {
  try {
    const result = await handler(options);

    if (!result.success) {
      const exitCode = result.exitCode ?? EXIT_CODES.UNHANDLED_EXCEPTION;
      if (options.json) {
        console.log(
          stringifyEnvelope(
            withTabMove(
              OutputBuilder.buildJsonError(result.error ?? 'Unknown error', {
                ...result.errorContext,
                ...(result.warning && { warning: result.warning }),
                exitCode,
              })
            )
          )
        );
      } else {
        console.error(result.error ? genericError(result.error) : unknownError());
        printTabMove(result.error);
        if (result.errorContext && typeof result.errorContext === 'object') {
          for (const value of Object.values(result.errorContext)) {
            if (value !== undefined && value !== null) {
              console.error(
                escapeControlChars(typeof value === 'string' ? value : JSON.stringify(value))
              );
            }
          }
        }
        printWarning(result.warning);
      }
      process.exit(exitCode);
    }

    if (!options.json) {
      printWarning(result.warning);
      printTabMove();
    }
    if (result.hint && !options.quiet) {
      console.error(escapeControlChars(result.hint));
    }

    if (options.json) {
      console.log(
        stringifyEnvelope(withTabMove(buildSuccessResponse(result.data, result.warning)))
      );
    } else if (formatter) {
      const formattedOutput = formatter(result.data as TResult);
      if (result.raw) {
        process.stdout.write(
          process.stdout.isTTY ? escapeControlChars(formattedOutput) : formattedOutput
        );
      } else {
        console.log(escapeControlChars(formattedOutput));
      }
    } else {
      console.log(stringifyEnvelope(withTabMove(buildSuccessResponse(result.data))));
    }

    process.exit(EXIT_CODES.SUCCESS);
  } catch (caught) {
    const error =
      caught instanceof IPCTimeoutError
        ? timeoutError(caught)
        : caught instanceof IPCEarlyCloseError
          ? sessionEndedError()
          : caught;
    if (error instanceof CommandError) {
      if (options.json) {
        console.log(
          stringifyEnvelope(
            withTabMove(
              OutputBuilder.buildJsonError(error.message, {
                ...error.metadata,
                exitCode: error.exitCode,
              })
            )
          )
        );
      } else {
        const { warning, ...metadata } = error.metadata;
        console.error(genericError(error.message));
        printTabMove(error.message);
        for (const value of Object.values(metadata)) {
          console.error(
            escapeControlChars(typeof value === 'string' ? value : JSON.stringify(value))
          );
        }
        printWarning(warning);
      }
      process.exit(error.exitCode);
    }

    const errorMessage = getErrorMessage(error);

    if (isDaemonConnectionError(error)) {
      if (options.json) {
        console.log(
          stringifyEnvelope(
            OutputBuilder.buildJsonError(noActiveSessionMessage(), {
              suggestion: startSessionSuggestion(),
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
            })
          )
        );
      } else {
        console.error(daemonNotRunningError());
      }
      process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
    }

    const exitCode = getErrorExitCode(error, EXIT_CODES.UNHANDLED_EXCEPTION);
    if (options.json) {
      console.log(
        stringifyEnvelope(withTabMove(OutputBuilder.buildJsonError(errorMessage, { exitCode })))
      );
    } else {
      console.error(genericError(errorMessage));
      printTabMove(errorMessage);
    }
    process.exit(exitCode);
  }
}
