/**
 * `bdg help <command...>` topics and Commander usage-error hints.
 */

import type { Command, CommanderError } from 'commander';

import { commandPath } from '@/commands/helpJson.js';
import { CommandError } from '@/errors/index.js';
import {
  didYouMeanSuggestion,
  missingSubcommandMessage,
  quotedArgumentsSuggestion,
  unknownCommandError,
  unknownHelpTopicError,
  usageHelpSuggestion,
} from '@/errors/messages.js';
import { JSON_FLAGS } from '@/utils/cliArgs.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar, findSimilarCommands } from '@/utils/suggestions.js';

/**
 * Commander's typo hint on its own line: "(Did you mean query?)" or, for
 * several equally close candidates, "(Did you mean one of form, frames?)"
 */
const COMMANDER_HINT = /\n?\(Did you mean (?:one of )?(.+)\?\)\s*$/;

/**
 * The command path of `bdg help <path...>`: the words before the first option.
 *
 * @param args - Arguments after `help`
 * @returns Command words, e.g. ['dom', 'query']
 */
export function helpTopicPath(args: string[]): string[] {
  const firstOption = args.findIndex((arg) => arg.startsWith('-'));
  return firstOption === -1 ? args : args.slice(0, firstOption);
}

/**
 * Reject a command path that does not exist: `bdg help <topic>` and
 * `bdg <command> --help --json` (instead of showing the general help and
 * exiting 0). Stops at a command without subcommands (further words are its
 * arguments) and at `help` itself.
 *
 * @param program - Root command with all commands registered
 * @param topic - Command words, e.g. ['dom', 'quer']
 * @param viaHelp - Whether the topic was asked through `bdg help` (else `--help`)
 * @throws CommandError (81) naming the unknown command
 */
export function assertKnownHelpTopic(program: Command, topic: string[], viaHelp = true): void {
  let command = program;
  const path: string[] = [];
  for (const word of topic) {
    if (command.commands.length === 0 || word === 'help') return;
    const sub = command.commands.find((c) => c.name() === word || c.aliases().includes(word));
    if (!sub) {
      const [closest] = findSimilarCommands(
        word,
        command.commands.map((c) => c.name())
      );
      const err =
        path.length === 0 && !viaHelp
          ? unknownCommandError(word, closest ? [closest] : [])
          : unknownHelpTopicError(
              [...path, word].join(' '),
              closest && [...path, closest].join(' '),
              viaHelp
            );
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    path.push(sub.name());
    command = sub;
  }
}

/**
 * Split Commander's error text into the message and a "did you mean" suggestion.
 *
 * @param text - Commander error message
 * @returns Message without the hint, and the hint as a suggestion
 */
export function splitCommanderHint(text: string): { message: string; suggestion?: string } {
  const message = text.replace(/^error:\s*/i, '');
  const hint = COMMANDER_HINT.exec(message);
  if (!hint) return { message };
  return {
    message: message.slice(0, hint.index).trim(),
    suggestion: didYouMeanSuggestion((hint[1] ?? '').split(', ')),
  };
}

/** The option named in Commander's "unknown option '--x'" message, without an `=value` */
const UNKNOWN_OPTION = /unknown option '([^'=]+)/;

/**
 * The long option of a command closest to a mistyped one, hidden global
 * options (`--session`, `--quiet`) included. Up to one edit per three letters
 * of the name counts as a typo, so `--frob` does not suggest `--json`.
 *
 * @param flag - Option as typed, e.g. "--sesion"
 * @param command - Command it was given to
 * @returns Closest long option, if any is similar
 */
function closestOption(flag: string, command: Command): string | undefined {
  const longs = command.options.flatMap((option) => (option.long ? [option.long] : []));
  const maxDistance = Math.ceil(flag.replace(/^-+/, '').length / 3);
  return findSimilar(flag, longs, { maxDistance })[0];
}

/**
 * The option as typed, for one Commander split: it reads `-josn` as `-j`
 * (`--json`) followed by `-osn`, and reports `-osn` as unknown.
 *
 * @param flag - Option Commander reported, e.g. "-osn"
 * @param argv - Process arguments
 * @returns The argument it came from, e.g. "-josn", else the option itself
 */
function typedOption(flag: string, argv: string[]): string {
  if (flag.startsWith('--')) return flag;
  const rest = flag.slice(1);
  return (
    argv.find((arg) => /^-[^-]/.test(arg) && arg.length > flag.length && arg.endsWith(rest)) ?? flag
  );
}

/** Arguments that hold free text, which a shell splits when typed unquoted */
const FREE_TEXT_ARGUMENTS = new Set([
  'selector',
  'selectorOrIndex',
  'pattern',
  'script',
  'value',
  'text',
  'search',
]);

/**
 * The suggestion for a command given more words than it takes, when the last
 * argument is free text that was probably typed without quotes.
 *
 * @param command - Command the error came from
 * @returns The quoted command and the help pointer, or undefined for other arguments
 */
function excessArgumentsSuggestion(command: Command): string | undefined {
  const taken = command.registeredArguments;
  const last = taken.at(-1);
  if (!last || last.variadic || !FREE_TEXT_ARGUMENTS.has(last.name())) return undefined;
  return quotedArgumentsSuggestion(commandPath(command), command.args, taken.length);
}

/**
 * Message and suggestion for a Commander usage error: a did-you-mean for an
 * unknown option or command, otherwise a pointer to the command's `--help`.
 * A word typed after a single dash (`-josn`) is matched against the long
 * options.
 *
 * @param error - Commander error (not a help or version display)
 * @param command - Command the error came from (see resolveCommand)
 * @param argv - Process arguments (to name an option as typed)
 * @param bareGroup - Whether the command is a group addressed without a subcommand
 *   (its `--json` is then a missing subcommand, not an unknown option)
 * @returns Message and suggestion
 */
export function usageErrorDetails(
  error: CommanderError,
  command: Command,
  argv: string[] = process.argv,
  bareGroup = false
): { message: string; suggestion: string } {
  const help = usageHelpSuggestion(commandPath(command));
  const { message, suggestion } = splitCommanderHint(error.message);
  const flag = error.code === 'commander.unknownOption' && UNKNOWN_OPTION.exec(message)?.[1];
  if (error.code === 'commander.help' || (bareGroup && flag && JSON_FLAGS.includes(flag))) {
    const names = command.commands.map((sub) => sub.name());
    return { message: missingSubcommandMessage(command.name(), names), suggestion: help };
  }
  if (error.code === 'commander.excessArguments') {
    return { message, suggestion: excessArgumentsSuggestion(command) ?? help };
  }
  if (!flag) return { message, suggestion: suggestion ?? help };
  const typed = typedOption(flag, argv);
  const closest = closestOption(/^-[^-]../.test(typed) ? `-${typed}` : typed, command);
  return {
    message: message.replace(`'${flag}'`, `'${typed}'`),
    suggestion: closest ? `Did you mean: ${closest}?` : help,
  };
}
