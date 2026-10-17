/**
 * How old spellings from the rename table (`@/utils/renames.ts`) reach the
 * code: they stay registered with Commander as hidden commands and options,
 * so Commander alone decides what is a command, an option or an argument
 * value, and the preAction hook ({@link applyRenamedNames}) acts on the ones
 * the command line used.
 */

import { Option, type Command } from 'commander';

import { CommandError } from '@/errors/index.js';
import { removedNameError, renamedNameError } from '@/errors/messages.js';
import { deprecatedNameWarning } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  RENAMES,
  isOptionEntry,
  isRetiredName,
  newSpelling,
  oldSpelling,
  type RenameEntry,
} from '@/utils/renames.js';

/**
 * The words of a command below the root, as the rename table writes them.
 *
 * @param command - Command
 * @returns e.g. `''` for the root, `'dom'`, `'dom a11y'`
 */
export function commandWords(command: Command): string {
  const names: string[] = [];
  for (let level = command; level.parent; level = level.parent) names.unshift(level.name());
  return names.join(' ');
}

/**
 * The command a table entry belongs to.
 *
 * @param program - Root command
 * @param words - Command words below the root
 * @returns The command
 * @throws Error when no such command is registered (a table bug)
 */
function findCommand(program: Command, words: string): Command {
  let command = program;
  for (const word of words.split(' ').filter(Boolean)) {
    const sub = command.commands.find((c) => c.name() === word);
    if (!sub) throw new Error(`Rename table: no command "${words}"`);
    command = sub;
  }
  return command;
}

/**
 * Commander's attribute name of a long option (`--kill-chrome` → `killChrome`).
 *
 * @param flag - Long option
 * @returns Attribute name
 */
function attributeName(flag: string): string {
  return new Option(flag).attributeName();
}

/**
 * Register an old option, hidden (or hide it when its command registers it).
 *
 * @param command - Command the option belongs to
 * @param entry - Option entry
 */
function registerOldOption(command: Command, entry: RenameEntry): void {
  const own = command.options.find((option) => option.long === entry.old);
  if (own) {
    own.hideHelp();
    return;
  }
  const flags = entry.takesValue ? `${entry.old} <value>` : entry.old;
  command.addOption(new Option(flags, `Old spelling of ${oldSpelling(entry)}`).hideHelp());
}

/**
 * Register an old command no module registers any more: hidden, taking any
 * arguments and options, so the preAction hook can name its replacement.
 *
 * @param parent - Command the old command belongs to
 * @param entry - Command entry
 */
function registerOldCommand(parent: Command, entry: RenameEntry): void {
  if (parent.commands.some((command) => command.name() === entry.old)) return;
  parent
    .command(entry.old, { hidden: true })
    .argument('[args...]')
    .allowUnknownOption()
    .action(() => undefined);
}

/**
 * Whether the command line used an entry's old spelling at this level: the
 * option given on the command line, or this command reached by its old name.
 *
 * @param level - Command at one level of the action command's chain
 * @param entry - Rename entry
 * @returns True when used
 */
function isUsed(level: Command, entry: RenameEntry): boolean {
  if (isOptionEntry(entry)) {
    return (
      entry.command === commandWords(level) &&
      level.getOptionValueSource(attributeName(entry.old)) === 'cli'
    );
  }
  return (
    level.parent !== null &&
    entry.command === commandWords(level.parent) &&
    entry.old === level.name()
  );
}

/**
 * The error for a removed spelling.
 *
 * @param entry - Removed entry
 * @returns Command error (81) naming the new spelling or what to do instead
 */
function removedError(entry: RenameEntry): CommandError {
  const replacement = newSpelling(entry);
  const err =
    replacement === undefined
      ? removedNameError(oldSpelling(entry), entry.hint ?? '')
      : renamedNameError(oldSpelling(entry), replacement);
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}

/**
 * Hand a deprecated option's value to the option that replaces it.
 *
 * @param level - Command the option belongs to
 * @param entry - Deprecated option entry
 */
function forwardOption(level: Command, entry: RenameEntry): void {
  if (!isOptionEntry(entry) || entry.new === undefined) return;
  const value: unknown = level.getOptionValue(attributeName(entry.old));
  level.setOptionValueWithSource(attributeName(entry.new), value, 'cli');
}

/**
 * The warning for a deprecated spelling.
 *
 * @param entry - Deprecated entry
 * @returns Warning text
 */
function deprecationWarning(entry: RenameEntry): string {
  const replacement = newSpelling(entry);
  const instead = replacement === undefined ? (entry.hint ?? '') : `use "${replacement}"`;
  return deprecatedNameWarning(oldSpelling(entry), instead);
}

/**
 * Register every old spelling of the table that its command does not
 * register itself: a hidden option (taking a value when the entry says so),
 * or a hidden command taking any arguments and options. An option a command
 * registers itself is hidden from help.
 *
 * @param program - Root command with all commands registered
 * @param table - Rename table
 */
export function registerRenamedNames(
  program: Command,
  table: readonly RenameEntry[] = RENAMES
): void {
  for (const entry of table) {
    const command = findCommand(program, entry.command);
    if (isOptionEntry(entry)) registerOldOption(command, entry);
    else registerOldCommand(command, entry);
  }
}

/**
 * Act on the old spellings the command line used, from the command about
 * to run up to the root: a removed one throws, a deprecated option renamed
 * to another passes its value to the new option, and each deprecated one
 * gives its warning.
 *
 * @param actionCommand - Command whose action is about to run
 * @param table - Rename table
 * @returns Warning texts, one per deprecated spelling used
 * @throws CommandError (81) for a removed spelling
 */
export function applyRenamedNames(
  actionCommand: Command,
  table: readonly RenameEntry[] = RENAMES
): string[] {
  const warnings: string[] = [];
  for (let level: Command | null = actionCommand; level; level = level.parent) {
    for (const entry of table) {
      if (!isUsed(level, entry)) continue;
      if (entry.stage === 'removed') throw removedError(entry);
      forwardOption(level, entry);
      warnings.push(deprecationWarning(entry));
    }
  }
  return warnings;
}

/**
 * A command's subcommands without the old spellings, for help and typo
 * suggestions.
 *
 * @param command - Command
 * @returns Current subcommands
 */
export function currentSubcommands(command: Command): Command[] {
  const words = commandWords(command);
  return command.commands.filter((sub) => !isRetiredName(words, sub.name()));
}

/**
 * A command's options without the old spellings, for help and typo
 * suggestions.
 *
 * @param command - Command
 * @returns Current options
 */
export function currentOptions(command: Command): Option[] {
  const words = commandWords(command);
  return command.options.filter((option) => !isRetiredName(words, option.long ?? ''));
}
