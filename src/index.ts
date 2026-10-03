#!/usr/bin/env node

import { Command, CommanderError, Option } from 'commander';

import { generateMachineReadableHelp, generateSubcommandHelp } from '@/commands/helpJson.js';
import { commandRegistry } from '@/commands.js';
import { genericError } from '@/errors/messages.js';
import { OutputBuilder, buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { enableDebugLogging } from '@/ui/logging/index.js';
import { getErrorExitCode, getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

const CLI_NAME = 'bdg';
const CLI_DESCRIPTION = 'Browser telemetry via Chrome DevTools Protocol';

/**
 * Extract command path from argv for subcommand help routing.
 *
 * Parses argv to find command names before --help flag.
 * Stops at first flag (starts with -) or --help.
 *
 * @param argv - Process arguments array
 * @returns Array of command names (e.g., ['dom', 'query'])
 *
 * @example
 * ```typescript
 * extractCommandPath(['node', 'bdg', 'dom', 'query', '--help', '--json'])
 * // Returns: ['dom', 'query']
 *
 * extractCommandPath(['node', 'bdg', '--help', '--json'])
 * // Returns: []
 * ```
 */
function extractCommandPath(argv: string[]): string[] {
  const commandPath: string[] = [];
  const args = argv.slice(2);

  for (const arg of args) {
    if (arg.startsWith('-')) {
      break;
    }
    commandPath.push(arg);
  }

  return commandPath;
}

/**
 * CLI arguments that can be flags: everything before a literal `--`.
 *
 * Values after `--` (e.g. `bdg dom fill sel -- -j`) must never be mistaken
 * for `--json` / `--help`.
 *
 * @returns Option-position arguments
 */
function flagArgs(): string[] {
  const args = process.argv.slice(2);
  const end = args.indexOf('--');
  return end === -1 ? args : args.slice(0, end);
}

/**
 * Whether JSON output was requested (`--json` / `-j`).
 *
 * @returns True for JSON mode
 */
function isJsonMode(): boolean {
  const args = flagArgs();
  return args.includes('--json') || args.includes('-j');
}

/**
 * Whether help was requested (`--help` or `-h`).
 *
 * @returns True if help was requested
 */
function wantsHelp(): boolean {
  const args = flagArgs();
  return args.includes('--help') || args.includes('-h');
}

/**
 * Turn `bdg help [command...]` into `bdg [command...] --help`.
 *
 * The root command takes a URL argument, so without this `help` would be
 * treated as a URL and start a session on `http://help`.
 */
function rewriteHelpCommand(): void {
  const [node = '', script = '', first, ...rest] = process.argv;
  if (first === 'help') {
    process.argv = [node, script, ...rest, '--help'];
  }
}

/**
 * Main entry point.
 *
 * Registers commands and dispatches. Only `bdg <url>` spawns the daemon (see
 * the start command); every other command talks to an existing daemon and
 * reports "no active session" when there is none.
 */
async function main(): Promise<void> {
  rewriteHelpCommand();
  const jsonMode = isJsonMode();
  const program = new Command()
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(VERSION)
    .option('--debug', 'Enable debug logging (verbose output)')
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        if (!jsonMode) process.stdout.write(text);
      },
      outputError: (message, write) => {
        if (!jsonMode) write(message);
      },
    });

  commandRegistry.forEach((register) => register(program));
  addGlobalDebugOption(program);
  program.hook('preAction', (_root, actionCommand) => applyGlobalOptions(program, actionCommand));

  if (jsonMode && wantsHelp()) {
    const commandPath = extractCommandPath(process.argv);
    const help =
      commandPath.length > 0
        ? generateSubcommandHelp(program, commandPath)
        : generateMachineReadableHelp(program);
    console.log(JSON.stringify(help, null, 2));
    process.exit(0);
  }

  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CommanderError) handleUsageError(error, jsonMode);
    throw error;
  }
}

/**
 * Make `--debug` accepted after any subcommand (program options are positional).
 *
 * @param command - Command whose subcommands get a hidden `--debug` option
 */
function addGlobalDebugOption(command: Command): void {
  for (const sub of command.commands) {
    if (!sub.options.some((option) => option.long === '--debug')) {
      sub.addOption(new Option('--debug', 'Enable debug logging').hideHelp());
    }
    addGlobalDebugOption(sub);
  }
}

/**
 * Apply program-level options to the command about to run.
 *
 * Enables debug logging for `--debug` anywhere, and forwards `--json` given
 * before the subcommand (`bdg --json peek`) to that subcommand.
 *
 * @param program - Root command
 * @param actionCommand - Command whose action is about to run
 */
function applyGlobalOptions(program: Command, actionCommand: Command): void {
  const root = program.opts<{ debug?: boolean; json?: boolean }>();
  const own = actionCommand.opts<{ debug?: boolean }>();
  if (root.debug || own.debug) enableDebugLogging();
  const acceptsJson = actionCommand.options.some((option) => option.long === '--json');
  if (root.json && actionCommand !== program && acceptsJson) {
    actionCommand.setOptionValue('json', true);
  }
}

/**
 * Exit for a Commander parse error (unknown option, missing argument, ...).
 *
 * Commander's own message goes to stderr in human mode; with `--json` a
 * response envelope is printed instead. Usage errors (including a command
 * group invoked without a subcommand) exit with 81; `--version --json` prints
 * `{ data: { version } }`.
 *
 * @param error - Commander error
 * @param jsonMode - Whether `--json` was requested
 */
function handleUsageError(error: CommanderError, jsonMode: boolean): never {
  if (error.code === 'commander.version') {
    if (jsonMode) console.log(JSON.stringify(buildSuccessResponse({ version: VERSION }), null, 2));
    process.exit(EXIT_CODES.SUCCESS);
  }
  if (error.code === 'commander.helpDisplayed') {
    process.exit(EXIT_CODES.SUCCESS);
  }
  const exitCode = EXIT_CODES.INVALID_ARGUMENTS;
  if (jsonMode) {
    const message =
      error.code === 'commander.help'
        ? 'Missing subcommand (run the command with --help to list subcommands)'
        : error.message.replace(/^error:\s*/i, '');
    console.log(JSON.stringify(OutputBuilder.buildJsonError(message, { exitCode }), null, 2));
  }
  process.exit(exitCode);
}

/**
 * Last-resort handler for errors that escaped command handlers.
 *
 * Prints one clean message (or a JSON envelope with `--json`) instead of a
 * raw stack trace, and exits with the error's semantic code when it has one.
 *
 * @param error - Unhandled error
 */
function handleFatalError(error: unknown): never {
  const exitCode = getErrorExitCode(error, EXIT_CODES.UNHANDLED_EXCEPTION);
  const message = getErrorMessage(error);
  if (isJsonMode()) {
    console.log(JSON.stringify(OutputBuilder.buildJsonError(message, { exitCode }), null, 2));
  } else {
    console.error(genericError(message));
  }
  process.exit(exitCode);
}

main().catch(handleFatalError);
