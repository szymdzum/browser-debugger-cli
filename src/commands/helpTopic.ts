/**
 * `bdg help <command...>` topics and Commander usage-error hints.
 */

import type { Command, CommanderError } from 'commander';

import { commandPath } from '@/commands/helpJson.js';
import { CommandError } from '@/errors/index.js';
import {
  missingSubcommandMessage,
  unknownHelpTopicError,
  usageHelpSuggestion,
} from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

/** Commander's typo hint on its own line, e.g. "(Did you mean query?)" */
const COMMANDER_HINT = /\n?\(Did you mean (.+)\?\)\s*$/;

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
 * Reject `bdg help <topic>` for a command that does not exist (instead of
 * showing the general help and exiting 0). Stops at a command without
 * subcommands (further words are its arguments) and at `help` itself.
 *
 * @param program - Root command with all commands registered
 * @param topic - Command path after `help`
 * @throws CommandError (81) naming the unknown command
 */
export function assertKnownHelpTopic(program: Command, topic: string[]): void {
  let command = program;
  const path: string[] = [];
  for (const word of topic) {
    if (command.commands.length === 0 || word === 'help') return;
    const sub = command.commands.find((c) => c.name() === word || c.aliases().includes(word));
    if (!sub) {
      const [closest] = findSimilar(
        word,
        command.commands.map((c) => c.name())
      );
      const err = unknownHelpTopicError(
        [...path, word].join(' '),
        closest && [...path, closest].join(' ')
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
  return { message: message.slice(0, hint.index).trim(), suggestion: `Did you mean: ${hint[1]}?` };
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
 * Message and suggestion for a Commander usage error: a did-you-mean for an
 * unknown option or command, otherwise a pointer to the command's `--help`.
 *
 * @param error - Commander error (not a help or version display)
 * @param command - Command the error came from (see resolveCommand)
 * @returns Message and suggestion
 */
export function usageErrorDetails(
  error: CommanderError,
  command: Command
): { message: string; suggestion: string } {
  const help = usageHelpSuggestion(commandPath(command));
  if (error.code === 'commander.help') {
    return { message: missingSubcommandMessage(), suggestion: help };
  }
  const { message, suggestion } = splitCommanderHint(error.message);
  const flag = error.code === 'commander.unknownOption' && UNKNOWN_OPTION.exec(message)?.[1];
  if (!flag) return { message, suggestion: suggestion ?? help };
  const closest = closestOption(flag, command);
  return { message, suggestion: closest ? `Did you mean: ${closest}?` : help };
}
