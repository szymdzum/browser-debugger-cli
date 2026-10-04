/**
 * `bdg help <command...>` topics and Commander usage-error hints.
 */

import type { Command } from 'commander';

import { CommandError } from '@/errors/index.js';
import { unknownHelpTopicError } from '@/errors/messages.js';
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
