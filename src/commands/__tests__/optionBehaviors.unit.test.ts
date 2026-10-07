/**
 * The option behavior registry against the real command tree: every key
 * names an option that exists, and root options get their behavior in help.
 * Keys match by the last command name, so one key can cover several commands
 * (`query:--limit` serves both `dom query` and `dom a11y query`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Command } from 'commander';

import { generateMachineReadableHelp } from '@/commands/helpJson.js';
import { behaviorKey, listBehaviorKeys } from '@/commands/optionBehaviors.js';
import { buildProgram } from '@/program.js';

/**
 * Registry keys of every option in a command tree.
 *
 * @param command - Command to walk
 * @returns Keys of its options and its subcommands' options
 */
function optionKeys(command: Command): string[] {
  return [
    ...command.options.map((option) => behaviorKey(command.name(), option)),
    ...command.commands.flatMap(optionKeys),
  ];
}

void describe('OPTION_BEHAVIORS', () => {
  it('every key resolves to a real option', () => {
    const resolved = new Set(optionKeys(buildProgram()));
    const dead = listBehaviorKeys().filter((key) => !resolved.has(key));
    assert.deepEqual(dead, []);
  });

  it('documents the root --headless, --no-headless and --all in help JSON', () => {
    const rootOptions = generateMachineReadableHelp(buildProgram()).command.options;
    const withBehavior = rootOptions
      .filter((option) => option.behavior)
      .map((option) => option.flags);
    for (const flags of ['--headless', '--no-headless', '-a, --all']) {
      assert.ok(withBehavior.includes(flags), `${flags} has no behavior`);
    }
  });
});
