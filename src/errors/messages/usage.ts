/**
 * Usage and help error messages.
 */

import { type ErrorWithSuggestion, shellWord } from './shared.js';

/**
 * `bdg help <topic>` for a command that does not exist.
 *
 * @param topic - Command path as typed, e.g. "dom quer"
 * @param closest - Most similar existing command path, if any
 * @param viaHelp - Whether it was asked through `bdg help` (else `--help`)
 */
export function unknownHelpTopicError(
  topic: string,
  closest?: string,
  viaHelp = true
): ErrorWithSuggestion {
  const parent = topic.split(' ').slice(0, -1).join(' ');
  return {
    message: `Unknown command: "${topic}"`,
    suggestion: closest
      ? `Did you mean: bdg ${viaHelp ? 'help ' : ''}${closest}?`
      : `Run "bdg ${parent ? `${parent} ` : ''}--help" for commands`,
  };
}

/**
 * "Did you mean" for one or more close candidates, joined as a sentence.
 *
 * @param candidates - Close matches, e.g. ["form", "frames"]
 * @returns e.g. "Did you mean: form or frames?" or "Did you mean: a, b or c?"
 */
export function didYouMeanSuggestion(candidates: string[]): string {
  const last = candidates.at(-1) ?? '';
  const rest = candidates.slice(0, -1);
  return `Did you mean: ${rest.length > 0 ? `${rest.join(', ')} or ${last}` : last}?`;
}

/**
 * Suggestion for a command-line usage error (missing argument, invalid value,
 * unknown option without a close match).
 *
 * @param path - Command path, e.g. "bdg dom query"
 */
export function usageHelpSuggestion(path: string): string {
  return `Run "${path} --help" for usage`;
}

/**
 * Suggestion for a command given more words than it takes where the last
 * argument is free text (an unquoted selector, pattern or value): the same
 * command with the surplus words joined into that argument, then the help.
 *
 * @param path - Command path, e.g. "bdg dom a11y query"
 * @param args - Arguments as typed
 * @param taken - Number of arguments the command takes
 * @returns e.g. `Did you mean: bdg dom a11y query "role=button name=Pay"?` and a help line
 */
export function quotedArgumentsSuggestion(path: string, args: string[], taken: number): string {
  const words = [...args.slice(0, taken - 1), args.slice(taken - 1).join(' ')];
  const written = words.map(shellWord).join(' ');
  return `Did you mean: ${path} ${written}?\n${usageHelpSuggestion(path)}`;
}

/**
 * Suggestion for a script given as several words: the shell removed the
 * quotes and spacing inside it, so the script cannot be rebuilt from them.
 *
 * @param path - Command path, e.g. "bdg eval"
 * @param words - Number of words the shell passed
 * @returns Instruction to quote the whole script, then the help pointer
 */
export function quoteScriptSuggestion(path: string, words: number): string {
  return `Quote the whole script as one argument: ${path} '<script>' (the shell split it into ${words} words and removed any quotes inside it)\n${usageHelpSuggestion(path)}`;
}

/**
 * A command group was run without one of its subcommands.
 *
 * @param group - Group name, e.g. "page"
 * @param subcommands - Names of its subcommands
 */
export function missingSubcommandMessage(group: string, subcommands: string[]): string {
  return `${group} needs a subcommand: ${subcommands.join(', ')}`;
}

/**
 * A daemon request named a command the session does not have (the IPC
 * server validates names, so this guards direct callers).
 *
 * @param name - Requested command name
 * @returns Error message
 */
export function unknownSessionCommandMessage(name: string): string {
  return `Unknown session command: "${name}"`;
}

/**
 * A bare word given where a URL is expected, most likely a mistyped command.
 *
 * @param word - The argument
 * @param similar - Similar command names
 */
export function unknownCommandError(word: string, similar: string[]): ErrorWithSuggestion {
  const [closest] = similar;
  return {
    message: `Unknown command: "${word}"`,
    suggestion: closest
      ? `Did you mean: bdg ${closest}?`
      : `Run "bdg --help" for commands. To open a host named "${word}", use a full URL: bdg http://${word}/`,
  };
}

/**
 * A command was given neither its argument nor a flag that replaces it.
 *
 * @param usage - How to call it
 * @returns Message and suggestion
 */
export function missingArgumentError(usage: string): ErrorWithSuggestion {
  return {
    message: 'Missing required argument or flag',
    suggestion: usage,
  };
}

/**
 * Either/or argument required.
 */
export function eitherArgumentRequiredError(
  arg1: string,
  arg2: string,
  example: string
): ErrorWithSuggestion {
  return {
    message: `Either ${arg1} or ${arg2} must be provided`,
    suggestion: example,
  };
}
