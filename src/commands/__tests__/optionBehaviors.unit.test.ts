/**
 * The option behavior registry against the real command tree: every key
 * names an option that exists, and root options get their behavior in help.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import { generateMachineReadableHelp } from '@/commands/helpJson.js';
import { behaviorKey, listBehaviorKeys } from '@/commands/optionBehaviors.js';
import { commandRegistry } from '@/commands.js';

/**
 * The CLI program as `src/index.ts` builds it: root name and options, then
 * every registered command.
 *
 * @returns Root command
 */
function realProgram(): Command {
  const program = new Command()
    .name('bdg')
    .option('--debug', 'Enable debug logging (verbose output)')
    .option('--session <name>', 'Use a named session');
  commandRegistry.forEach((register) => register(program));
  return program;
}

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
    const resolved = new Set(optionKeys(realProgram()));
    const dead = listBehaviorKeys().filter((key) => !resolved.has(key));
    assert.deepEqual(dead, []);
  });

  it('documents the root --headless, --no-headless and --all in help JSON', () => {
    const rootOptions = generateMachineReadableHelp(realProgram()).command.options;
    const withBehavior = rootOptions
      .filter((option) => option.behavior)
      .map((option) => option.flags);
    for (const flags of ['--headless', '--no-headless', '-a, --all']) {
      assert.ok(withBehavior.includes(flags), `${flags} has no behavior`);
    }
  });
});
