/**
 * The option behavior registry against the real command tree: every key
 * names an option that exists, and root options get their behavior in help.
 * Keys match by the last command name, so one key can cover several commands
 * (`query:--limit` serves both `dom query` and `dom a11y query`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Command, Option } from 'commander';

import { generateMachineReadableHelp } from '@/commands/helpJson.js';
import { FOLLOW_BEHAVIOR } from '@/commands/optionBehaviors/shared.js';
import { BEHAVIOR_TABLES, behaviorKey, listBehaviorKeys } from '@/commands/optionBehaviors.js';
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

  it('no key is in two area tables', () => {
    const keys = BEHAVIOR_TABLES.flatMap((table) => Object.keys(table));
    const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(repeated, []);
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

void describe('FOLLOW_BEHAVIOR', () => {
  void it('describes --json as one whole envelope per refresh, the first with the backlog (#714)', () => {
    assert.match(FOLLOW_BEHAVIOR, /envelope per update/);
    assert.match(FOLLOW_BEHAVIOR, /first line carries the backlog/);
    assert.doesNotMatch(FOLLOW_BEHAVIOR, /default \d+/, '--last defaults differ per command');
    assert.doesNotMatch(FOLLOW_BEHAVIOR, /compact object/);
  });
});

void describe('--follow behavior against the real --last defaults', () => {
  void it('every attached follow entry carries the shared text', () => {
    const keys = ['peek:--follow', 'console:--follow', 'network:--follow', 'list:--follow'];
    const entries = BEHAVIOR_TABLES.flatMap((table) =>
      keys.flatMap((key) => (table[key] ? [table[key]] : []))
    );
    assert.ok(entries.length >= 3);
    for (const entry of entries) assert.equal(entry.automaticBehavior, FOLLOW_BEHAVIOR);
  });

  void it('--last defaults named in the docs match the option definitions', () => {
    const program = buildProgram();
    const find = (path: string[]): Option | undefined => {
      let cmd: Command | undefined = program;
      for (const name of path) cmd = cmd?.commands.find((c) => c.name() === name);
      return cmd?.options.find((o) => o.long === '--last');
    };
    assert.equal(find(['peek'])?.defaultValue, '10');
    assert.equal(find(['network', 'list'])?.defaultValue, '100');
  });
});
