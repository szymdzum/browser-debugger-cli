/**
 * How old spellings from the rename table (`@/utils/renames.ts`) reach the
 * code: they stay registered with Commander as hidden commands and options,
 * so Commander alone decides what is a command, an option or an argument
 * value, and the preAction hook ({@link applyRenamedNames}) acts on the ones
 * the command line used.
 */

import type { Command } from 'commander';

import { RENAMES, type RenameEntry } from '@/utils/renames.js';

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
  void program;
  void table;
  throw new Error('not implemented');
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
  void actionCommand;
  void table;
  throw new Error('not implemented');
}
