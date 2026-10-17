/**
 * How old spellings from the rename table (`@/utils/renames.ts`) reach the
 * code: they stay registered with Commander as hidden commands and options,
 * so Commander alone decides what is a command, an option or an argument
 * value, and the preAction hook ({@link applyRenamedNames}) acts on the ones
 * the command line used.
 */

import { Option, type Command } from 'commander';

import { CommandError } from '@/errors/index.js';
import { renamedOptionConflictError, retiredNameError } from '@/errors/messages.js';
import { deprecatedNameWarning } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { RENAMES, isRetiredName, spelling, type RenameEntry } from '@/utils/renames.js';
import { findSimilarCommands } from '@/utils/suggestions.js';

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
 * Commander's attribute name of a long option (`--kill-chrome` → `killChrome`)
 * or a short-only one (`-f` → `f`).
 *
 * @param flag - Long or short option
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
function registerOldOption(command: Command, entry: RenameEntry & { kind: 'option' }): void {
  const own = command.options.find(
    (option) => option.long === entry.old || option.short === entry.old
  );
  if (own) {
    own.hideHelp();
    return;
  }
  const flags = entry.takesValue ? `${entry.old} <value>` : entry.old;
  command.addOption(new Option(flags, `Old spelling of ${spelling(entry, 'old')}`).hideHelp());
}

/**
 * Hide a registered command from help. Commander has no public call for it
 * (`hidden` is an option of `.command()` only), so this sets its private
 * `_hidden` flag (commander ^15). A commander upgrade that breaks it fails
 * the contract test "help lists only the new names"
 * (`canonicalNames.contract.test.ts`) and the unit test "a deprecated old
 * command is registered and hidden from help" (`renamedNames.unit.test.ts`).
 *
 * @param command - Registered command
 */
function hideCommand(command: Command): void {
  (command as unknown as { _hidden: boolean })._hidden = true;
}

/**
 * Check an old command: a deprecated one must still be registered by its
 * module, so it keeps working, and is hidden here; a removed one gets a hidden stub
 * taking any arguments and options, whose preAction check exits 81.
 *
 * @param parent - Command the old command belongs to
 * @param entry - Command entry
 * @throws Error for a deprecated command no module registers (a table bug)
 */
function registerOldCommand(parent: Command, entry: RenameEntry & { kind: 'command' }): void {
  const registered = parent.commands.find((command) => command.name() === entry.old);
  if (entry.stage === 'deprecated') {
    if (!registered) throw new Error(`Rename table: "${spelling(entry, 'old')}" is not registered`);
    hideCommand(registered);
    return;
  }
  if (registered) return;
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
 * @param entry - Rename entry of this level (options) or of its parent (commands)
 * @param oldAttribute - Attribute name of an option entry's old option
 * @returns True when used
 */
function isUsed(level: Command, entry: RenameEntry, oldAttribute: string): boolean {
  return entry.kind === 'option'
    ? level.getOptionValueSource(oldAttribute) === 'cli'
    : entry.old === level.name();
}

/**
 * The error for a removed spelling.
 *
 * @param entry - Removed entry
 * @returns Command error (81) naming the new spelling or what to do instead
 */
function removedError(entry: RenameEntry): CommandError {
  const err = retiredNameError(
    spelling(entry, 'old'),
    entry.new === undefined ? { hint: entry.hint } : { newSpelling: spelling(entry, 'new') }
  );
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}

/**
 * The warning for a deprecated spelling.
 *
 * @param entry - Deprecated entry
 * @returns Warning text
 */
function deprecationWarning(entry: RenameEntry): string {
  const instead = entry.new === undefined ? entry.hint : `use "${spelling(entry, 'new')}"`;
  return deprecatedNameWarning(spelling(entry, 'old'), instead);
}

/**
 * Register every old spelling of the table (see {@link registerOldOption}
 * and {@link registerOldCommand}).
 *
 * @param program - Root command with all commands registered
 * @param table - Rename table
 * @throws Error for an entry whose command, or deprecated old command, is not registered
 */
export function registerRenamedNames(
  program: Command,
  table: readonly RenameEntry[] = RENAMES
): void {
  for (const entry of table) {
    const command = findCommand(program, entry.command);
    if (entry.kind === 'option') registerOldOption(command, entry);
    else registerOldCommand(command, entry);
  }
}

/**
 * Give a deprecated option's value to the option that replaces it.
 *
 * @param level - Command that has both options
 * @param entry - Deprecated option entry with a new option
 * @param oldAttribute - Attribute name of the old option
 * @throws CommandError (81) when the command line also gave the new option
 */
function passToNewOption(
  level: Command,
  entry: RenameEntry & { kind: 'option' },
  oldAttribute: string
): void {
  const newAttribute = attributeName(entry.new ?? '');
  if (level.getOptionValueSource(newAttribute) === 'cli') {
    const err = renamedOptionConflictError(spelling(entry, 'old'), spelling(entry, 'new'));
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  level.setOptionValueWithSource(newAttribute, level.getOptionValue(oldAttribute), 'cli');
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
    const words = commandWords(level);
    const parentWords = level.parent ? commandWords(level.parent) : undefined;
    for (const entry of table) {
      if (entry.command !== (entry.kind === 'option' ? words : parentWords)) continue;
      const oldAttribute = entry.kind === 'option' ? attributeName(entry.old) : '';
      if (!isUsed(level, entry, oldAttribute)) continue;
      if (entry.stage === 'removed') throw removedError(entry);
      if (entry.kind === 'option' && entry.new !== undefined) {
        passToNewOption(level, entry, oldAttribute);
      }
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
  return command.options.filter(
    (option) => !isRetiredName(words, option.long ?? option.short ?? '')
  );
}

/** Commander's message for a word that is no subcommand */
const UNKNOWN_COMMAND = /unknown command '([^']+)'/;

/**
 * The new spelling of an old command that a mistyped subcommand is close to:
 * `bdg dom evl` is a typo of the old `dom eval`, so it suggests `bdg eval`
 * (Commander only compares with current names, which cannot include a
 * command that moved to another parent).
 *
 * @param command - Command that reported the unknown subcommand
 * @param message - Commander's error message
 * @param table - Rename table
 * @returns Suggestion naming the new spelling, if the word is close to an old one
 */
export function renamedCommandSuggestion(
  command: Command,
  message: string,
  table: readonly RenameEntry[] = RENAMES
): string | undefined {
  const word = UNKNOWN_COMMAND.exec(message)?.[1];
  if (word === undefined) return undefined;
  const words = commandWords(command);
  const entries = table.filter(
    (entry) => entry.kind === 'command' && entry.command === words && entry.new !== undefined
  );
  const [closest] = findSimilarCommands(
    word,
    entries.map((entry) => entry.old)
  );
  const entry = entries.find((candidate) => candidate.old === closest);
  return entry && `Did you mean: ${spelling(entry, 'new')}?`;
}

/**
 * The new spelling of a command reached by a deprecated old name, so a usage
 * error points at the command that exists (`bdg dom press-key`, not
 * `bdg dom pressKey`).
 *
 * @param command - Command a usage error came from
 * @param table - Rename table
 * @returns `bdg …` spelling of the new command, if this one is a deprecated old name
 */
export function renamedCommandPath(
  command: Command,
  table: readonly RenameEntry[] = RENAMES
): string | undefined {
  const parentWords = command.parent ? commandWords(command.parent) : undefined;
  const entry = table.find(
    (row) =>
      row.kind === 'command' &&
      row.stage === 'deprecated' &&
      row.new !== undefined &&
      row.command === parentWords &&
      row.old === command.name()
  );
  return entry && spelling(entry, 'new');
}
