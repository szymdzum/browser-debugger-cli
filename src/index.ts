#!/usr/bin/env node

import { CommanderError, type Command } from 'commander';

import {
  generateCommandHelp,
  generateCompactHelp,
  generateMachineReadableHelp,
  resolveCommand,
} from '@/commands/helpJson.js';
import { assertKnownHelpTopic, helpTopicPath, usageErrorDetails } from '@/commands/helpTopic.js';
import { assertNotMistypedCommand } from '@/commands/start.js';
import { CommandError } from '@/errors/index.js';
import { genericError } from '@/errors/messages.js';
import { buildProgram } from '@/program.js';
import { selectSession } from '@/session/sessionName.js';
import { OutputBuilder, buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { hideHints } from '@/ui/formatting.js';
import { enableDebugLogging } from '@/ui/logging/index.js';
import { getErrorExitCode, getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

/** Asks `bdg --help --json` for every command's full metadata instead of the compact tree */
const FULL_HELP_FLAG = '--full';

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
 * The words of the command line that are not options (command names,
 * arguments, option values), for finding the command addressed.
 *
 * @returns Non-option arguments before a literal `--`
 */
function commandWords(): string[] {
  return flagArgs().filter((arg) => !arg.startsWith('-'));
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

/** Flags that may accompany a bare `bdg --json` (anything else has its own meaning) */
const BARE_JSON_FLAGS = new Set(['--json', '-j', '--debug', FULL_HELP_FLAG]);

/**
 * Whether `bdg --json` was run on its own (no command, URL or other option),
 * which answers with the machine-readable help.
 *
 * @returns True for a bare `bdg --json`
 */
function hasNoArguments(): boolean {
  return process.argv.slice(2).every((arg) => BARE_JSON_FLAGS.has(arg));
}

/**
 * Turn `bdg help [command...]` into `bdg [command...] --help`.
 *
 * The root command takes a URL argument, so without this `help` would be
 * treated as a URL and start a session on `http://help`.
 *
 * @returns The command path asked about (empty without `help`)
 */
function rewriteHelpCommand(): string[] {
  const [node = '', script = '', first, ...rest] = process.argv;
  if (first !== 'help') return [];
  process.argv = [node, script, ...rest, '--help'];
  return helpTopicPath(rest);
}

/**
 * Configure stdout and stderr for piping.
 *
 * Pipes are asynchronous in Node on POSIX: `process.exit()` right after a
 * large write drops whatever the reader has not consumed yet, so `bdg … | jq`
 * received at most 64 KB. Blocking writes complete before any exit path runs.
 * A reader that closes early (`bdg peek -f | head`) ends the command quietly
 * instead of crashing on EPIPE.
 */
function configureStdio(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const handle = (
      stream as unknown as { _handle?: { setBlocking?: (blocking: boolean) => void } }
    )._handle;
    handle?.setBlocking?.(true);
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') throw error;
      process.exit(process.exitCode ?? EXIT_CODES.SUCCESS);
    });
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
  configureStdio();
  const helpTopic = rewriteHelpCommand();
  const jsonMode = isJsonMode();
  const program = buildProgram({
    writeOut: (text) => {
      if (!jsonMode) process.stdout.write(text);
    },
    outputError: () => undefined,
  });
  program.hook('preAction', (_root, actionCommand) => applyGlobalOptions(program, actionCommand));
  assertKnownHelpTopic(program, helpTopic);
  assertNotMistypedCommand(program, process.argv);

  if (jsonMode && (wantsHelp() || hasNoArguments())) {
    selectSession(sessionFromArgv(process.argv));
    console.log(JSON.stringify(helpJson(program)));
    process.exit(0);
  }

  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CommanderError) {
      handleUsageError(error, resolveCommand(program, commandWords()), jsonMode);
    }
    throw error;
  }
}

/**
 * Machine-readable help for `--help --json`: the command's full help when the
 * command line names one, otherwise the compact root help (the full one with
 * `--full`).
 *
 * @param program - Root command with all commands registered
 * @returns Help to print
 */
function helpJson(program: Command): object {
  const command = resolveCommand(program, commandWords());
  if (command !== program) return generateCommandHelp(program, command);
  return flagArgs().includes(FULL_HELP_FLAG)
    ? generateMachineReadableHelp(program)
    : generateCompactHelp(program);
}

/**
 * The `--session` value on the command line, for paths that run before
 * Commander parses it (`bdg --help --json --session a`).
 *
 * @param argv - Process arguments
 * @returns The last `--session <name>` / `--session=<name>` value, if any
 */
function sessionFromArgv(argv: string[]): string | undefined {
  let value: string | undefined;
  argv.forEach((arg, i) => {
    if (arg === '--session') value = argv[i + 1];
    else if (arg.startsWith('--session=')) value = arg.slice('--session='.length);
  });
  return value;
}

/**
 * The value of a global option closest to the command that runs: the command
 * itself, then its group (`bdg dom --session a query`), then the program.
 *
 * @param command - Command about to run
 * @param key - Option attribute name
 * @returns The value, or undefined when no level was given the option
 */
function nearestOption<T>(command: Command, key: string): T | undefined {
  for (let level: Command | null = command; level; level = level.parent) {
    const value = level.opts<Record<string, T | undefined>>()[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Apply program-level options to the command about to run.
 *
 * Enables debug logging for `--debug` anywhere, hides hints for `-q`, selects the session
 * (the `--session` closest to the subcommand wins, then `BDG_SESSION`), and forwards
 * `--json` given before the subcommand (`bdg --json peek`) to that subcommand.
 *
 * @param program - Root command
 * @param actionCommand - Command whose action is about to run
 * @throws CommandError (81) for an invalid session name
 */
function applyGlobalOptions(program: Command, actionCommand: Command): void {
  const root = program.opts<{ json?: boolean }>();
  if (nearestOption<boolean>(actionCommand, 'debug')) enableDebugLogging();
  selectSession(nearestOption<string>(actionCommand, 'session'));
  if (nearestOption<boolean>(actionCommand, 'quiet')) hideHints();
  const acceptsJson = actionCommand.options.some((option) => option.long === '--json');
  if (root.json && actionCommand !== program && acceptsJson) {
    actionCommand.setOptionValue('json', true);
  }
}

/**
 * Exit for a Commander parse error (unknown option, missing argument, ...).
 *
 * Prints the message with a suggestion (a did-you-mean for a mistyped option
 * or command, else the command's `--help`) to stderr, or as a response
 * envelope with `--json`. Usage errors (including a command group invoked
 * without a subcommand, whose help Commander already printed) exit with 81;
 * `--version --json` prints `{ data: { version } }`.
 *
 * @param error - Commander error
 * @param command - Command the error came from
 * @param jsonMode - Whether `--json` was requested
 */
function handleUsageError(error: CommanderError, command: Command, jsonMode: boolean): never {
  if (error.code === 'commander.version') {
    if (jsonMode) console.log(JSON.stringify(buildSuccessResponse({ version: VERSION }), null, 2));
    process.exit(EXIT_CODES.SUCCESS);
  }
  if (
    error.code === 'commander.helpDisplayed' ||
    (error.code === 'commander.help' && error.exitCode === 0)
  ) {
    process.exit(EXIT_CODES.SUCCESS);
  }
  const exitCode = EXIT_CODES.INVALID_ARGUMENTS;
  const { message, suggestion } = usageErrorDetails(error, command);
  if (jsonMode) {
    console.log(
      JSON.stringify(OutputBuilder.buildJsonError(message, { exitCode, suggestion }), null, 2)
    );
  } else if (error.code !== 'commander.help') {
    console.error(genericError(message, suggestion));
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
  const metadata = error instanceof CommandError ? error.metadata : {};
  if (isJsonMode()) {
    console.log(
      JSON.stringify(OutputBuilder.buildJsonError(message, { ...metadata, exitCode }), null, 2)
    );
  } else {
    console.error(genericError(message));
    if (typeof metadata.suggestion === 'string') console.error(metadata.suggestion);
  }
  process.exit(exitCode);
}

main().catch(handleFatalError);
