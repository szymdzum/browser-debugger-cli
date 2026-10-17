/**
 * The CLI: parses the command line and runs the command ({@link runCli}).
 * Loaded by the entry point (`src/index.ts`) once Ctrl-C and SIGTERM are
 * reported.
 */

import { CommanderError, type Command } from 'commander';

import {
  commandLineWords,
  commandPath,
  generateCommandHelp,
  generateCompactHelp,
  generateMachineReadableHelp,
  resolveCommand,
} from '@/commands/helpJson.js';
import { assertKnownHelpTopic, helpTopicPath, usageErrorDetails } from '@/commands/helpTopic.js';
import { printWarning } from '@/commands/shared/CommandRunner.js';
import { applyRenamedNames } from '@/commands/shared/renamedNames.js';
import { assertNotMistypedCommand, isBareWord } from '@/commands/start.js';
import { CommandError } from '@/errors/index.js';
import { genericError, jsonTakenAsValueError, noCommandOrUrlError } from '@/errors/messages.js';
import { buildProgram } from '@/program.js';
import { selectSession } from '@/session/sessionName.js';
import {
  OutputBuilder,
  addEnvelopeWarning,
  buildSuccessResponse,
  stringifyEnvelope,
} from '@/ui/OutputBuilder.js';
import { hideHints } from '@/ui/formatting.js';
import { enableDebugLogging } from '@/ui/logging/index.js';
import { JSON_FLAGS, flagArgs, isJsonMode } from '@/utils/cliArgs.js';
import { getErrorExitCode, getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

/** Asks `bdg --help --json` for every command's full metadata instead of the compact tree */
const FULL_HELP_FLAG = '--full';

/**
 * The words of the command line that are command names or arguments (not
 * options or their values), for finding the command addressed.
 *
 * @param program - Root command with all commands registered
 * @returns Non-option words before a literal `--`
 */
function commandWords(program: Command): string[] {
  return commandLineWords(program, flagArgs());
}

/**
 * Before parsing, reject `--json` / `-j` typed where an option's value belongs
 * (`bdg network list --last --json`): Commander would take it as the value
 * and the command would answer in human mode. The arguments are read left to
 * right as Commander does, so a value-taking option swallows the next word
 * (`--filter --last --json` has the value `--last` and a real `--json`).
 * `--last=--json` and values after `--` are values.
 *
 * @param command - Command about to run
 * @throws CommandError (81) naming the option that lacks its value
 */
function assertJsonNotTakenAsValue(command: Command): void {
  const valueOptions = new Map<string, string>();
  for (let level: Command | null = command; level; level = level.parent) {
    for (const option of level.options.filter((o) => o.required)) {
      const long = option.long ?? option.short ?? '';
      for (const flag of [option.long, option.short]) if (flag) valueOptions.set(flag, long);
    }
  }
  const args = flagArgs();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const long = valueOptions.get(arg);
    if (long === undefined) continue;
    const next = args[i + 1] ?? '';
    if (JSON_FLAGS.includes(next)) {
      const err = jsonTakenAsValueError(arg, next, long);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    i++;
  }
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
 * Whether `bdg --json` was run with no command and no URL: only the JSON
 * flag and global options (`--debug`, `--full`, `--session <name>`).
 *
 * @returns True for a bare `bdg --json`
 */
function hasNoArguments(): boolean {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--session') {
      if (args[i + 1]?.startsWith('-') ?? true) return false;
      i++;
    } else if (arg === '--session=') return false;
    else if (!arg.startsWith('--session=') && !BARE_JSON_FLAGS.has(arg)) return false;
  }
  return true;
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
    writeErr: (text) => {
      if (!jsonMode) process.stderr.write(text);
    },
    outputError: () => undefined,
  });
  program.hook('preAction', (_root, actionCommand) => {
    applyGlobalOptions(program, actionCommand);
    reportDeprecations(applyRenamedNames(actionCommand), jsonMode);
  });
  assertKnownHelpTopic(program, helpTopic);
  assertNotMistypedCommand(program, process.argv);

  if (jsonMode && wantsHelp()) {
    assertKnownHelpCommand(program);
    selectSession(sessionFromArgv(process.argv));
    console.log(JSON.stringify(helpJson(program)));
    process.exit(0);
  }
  if (jsonMode && hasNoArguments()) {
    const { message, suggestion } = noCommandOrUrlError();
    const exitCode = EXIT_CODES.INVALID_ARGUMENTS;
    console.log(stringifyEnvelope(OutputBuilder.buildJsonError(message, { exitCode, suggestion })));
    process.exit(exitCode);
  }

  assertJsonNotTakenAsValue(resolveCommand(program, commandWords(program)));

  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CommanderError) {
      handleUsageError(error, program, jsonMode);
    }
    throw error;
  }
}

/**
 * Reject `--help --json` for a command that does not exist, as `bdg nosuch --json`
 * is rejected. A first word that cannot be a command name is a start URL
 * (`bdg example.com --help --json`) and gets the root help.
 *
 * @param program - Root command with all commands registered
 * @throws CommandError (81) naming the unknown command
 */
function assertKnownHelpCommand(program: Command): void {
  const words = commandWords(program);
  if (words[0] !== undefined && !isBareWord(words[0])) return;
  assertKnownHelpTopic(program, words, false);
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
  const command = resolveCommand(program, commandWords(program));
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
 * Report the old spellings the command line used, once per invocation and
 * before the command runs: a `Warning:` line on stderr each, or with
 * `--json` in the `warnings` of every envelope printed (nothing on stderr).
 * Doing it before the action means an early `process.exit` or a signal
 * cannot lose them.
 *
 * @param warnings - Warning texts
 * @param jsonMode - Whether `--json` was requested
 */
function reportDeprecations(warnings: string[], jsonMode: boolean): void {
  for (const warning of warnings) {
    if (jsonMode) addEnvelopeWarning(warning);
    else printWarning(warning);
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
 * @param program - Root command (the command the error came from is found on the command line)
 * @param jsonMode - Whether `--json` was requested
 */
function handleUsageError(error: CommanderError, program: Command, jsonMode: boolean): never {
  if (error.code === 'commander.version') {
    if (jsonMode) console.log(stringifyEnvelope(buildSuccessResponse({ version: VERSION })));
    process.exit(EXIT_CODES.SUCCESS);
  }
  if (
    error.code === 'commander.helpDisplayed' ||
    (error.code === 'commander.help' && error.exitCode === 0)
  ) {
    process.exit(EXIT_CODES.SUCCESS);
  }
  const exitCode = EXIT_CODES.INVALID_ARGUMENTS;
  const words = commandWords(program);
  const command = resolveCommand(program, words);
  const bareGroup =
    command.commands.length > 0 && words.length === commandPath(command).split(' ').length - 1;
  const { message, suggestion } = usageErrorDetails(error, command, process.argv, bareGroup);
  reportDeprecations(applyRenamedNames(command), jsonMode);
  if (jsonMode) {
    console.log(stringifyEnvelope(OutputBuilder.buildJsonError(message, { exitCode, suggestion })));
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
    const fields = { exitCode, ...metadata };
    fields.exitCode = exitCode;
    console.log(stringifyEnvelope(OutputBuilder.buildJsonError(message, fields)));
  } else {
    console.error(genericError(message));
    if (typeof metadata.suggestion === 'string') console.error(metadata.suggestion);
  }
  process.exit(exitCode);
}

/**
 * Run the CLI on `process.argv`; every path ends the process.
 */
export function runCli(): void {
  main().catch(handleFatalError);
}
