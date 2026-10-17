/**
 * The rename mechanism (#465) with injected tables: a removed command, a
 * deprecated and a removed option that take a value, argument values equal
 * to an old name, hiding from typo suggestions, and the CLI reference table
 * kept in sync with the real table.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import {
  applyRenamedNames,
  currentSubcommands,
  registerRenamedNames,
} from '@/commands/shared/renamedNames.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { buildProgram } from '@/program.js';
import { RENAMES, isRetiredName, spelling, type RenameEntry } from '@/utils/renames.js';
import { findSimilarCommands } from '@/utils/suggestions.js';

const TABLE: readonly RenameEntry[] = [
  { kind: 'command', command: '', old: 'gone', new: 'fresh', stage: 'removed' },
  { kind: 'command', command: 'grp', old: 'moved', new: 'fresh', stage: 'deprecated' },
  {
    kind: 'option',
    command: 'run',
    old: '--old-name',
    new: '--new-name',
    stage: 'deprecated',
    takesValue: true,
  },
  {
    kind: 'option',
    command: 'run',
    old: '--old-size',
    new: '--size',
    stage: 'removed',
    takesValue: true,
  },
];

interface Parsed {
  ran?: string;
  opts?: Record<string, unknown>;
  args?: string[];
  warnings: string[];
}

/**
 * Parse a command line with a toy program using {@link TABLE}.
 *
 * @param argv - Arguments after the program name
 * @returns Options and arguments `run` got, and the warnings
 */
async function parse(argv: string[]): Promise<Parsed> {
  const parsed: Parsed = { warnings: [] };
  const program = new Command('bdg').exitOverride();
  program.command('fresh').action(() => {
    parsed.ran = 'fresh';
  });
  program
    .command('grp')
    .command('moved', { hidden: true })
    .action(() => {
      parsed.ran = 'grp moved';
    });
  program
    .command('run')
    .option('--new-name <name>', 'Name')
    .option('--size <n>', 'Size')
    .argument('[args...]')
    .action((args: string[], opts: Record<string, unknown>) => {
      parsed.args = args;
      parsed.opts = opts;
    });
  registerRenamedNames(program, TABLE);
  program.hook('preAction', (_root, action) => {
    parsed.warnings.push(...applyRenamedNames(action, TABLE));
  });
  await program.parseAsync(argv, { from: 'user' });
  return parsed;
}

/**
 * Assert a parse fails with the rename error.
 *
 * @param argv - Arguments after the program name
 * @param message - Expected error message
 * @param suggestion - Expected suggestion
 */
async function assertRenameError(
  argv: string[],
  message: string,
  suggestion: string
): Promise<void> {
  await assert.rejects(parse(argv), (error: unknown) => {
    assert.ok(error instanceof CommandError, String(error));
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.equal(error.message, message);
    assert.equal(error.metadata['suggestion'], suggestion);
    return true;
  });
}

void describe('rename mechanism (injected table)', () => {
  void it('a removed command exits 81 naming the new one, whatever follows it', async () => {
    await assertRenameError(
      ['gone', 'x', '--flag'],
      '"bdg gone" was renamed to "bdg fresh"',
      'Use "bdg fresh"'
    );
  });

  void it('a deprecated command moved to another parent runs, warning with its full new path', async () => {
    const parsed = await parse(['grp', 'moved']);
    assert.equal(parsed.ran, 'grp moved');
    assert.deepEqual(parsed.warnings, [
      '"bdg grp moved" is deprecated and will be removed in 1.0: use "bdg fresh"',
    ]);
  });

  void it('a deprecated command no module registers is a table bug', () => {
    const program = new Command('bdg');
    program.command('grp');
    assert.throws(
      () => registerRenamedNames(program, [TABLE[1] as RenameEntry]),
      /"bdg grp moved" is not registered/
    );
  });

  void it('a deprecated option passes its value to the new one, both forms', async () => {
    const warning =
      '"bdg run --old-name" is deprecated and will be removed in 1.0: use "bdg run --new-name"';
    for (const argv of [
      ['run', '--old-name', 'a'],
      ['run', '--old-name=a'],
    ]) {
      const parsed = await parse(argv);
      assert.equal(parsed.opts?.['newName'], 'a', argv.join(' '));
      assert.deepEqual(parsed.warnings, [warning], argv.join(' '));
    }
  });

  void it('a removed option that takes a value exits 81, both forms', async () => {
    for (const argv of [
      ['run', '--old-size', '3'],
      ['run', '--old-size=3'],
    ]) {
      await assertRenameError(
        argv,
        '"bdg run --old-size" was renamed to "bdg run --size"',
        'Use "bdg run --size"'
      );
    }
  });

  void it('an old name as an argument value is neither rewritten nor warned about', async () => {
    const afterDashes = await parse(['run', '--', '--old-name', 'gone']);
    assert.deepEqual(afterDashes.args, ['--old-name', 'gone']);
    assert.deepEqual(afterDashes.warnings, []);
    const optionValue = await parse(['run', '--new-name', '--old-name']);
    assert.equal(optionValue.opts?.['newName'], '--old-name');
    assert.deepEqual(optionValue.warnings, []);
    const positional = await parse(['run', 'gone']);
    assert.deepEqual(positional.args, ['gone']);
    assert.deepEqual(positional.warnings, []);
  });

  void it('the new spelling gives no warning', async () => {
    const parsed = await parse(['run', '--new-name', 'a']);
    assert.equal(parsed.opts?.['newName'], 'a');
    assert.deepEqual(parsed.warnings, []);
  });
});

void describe('old spellings in suggestions', () => {
  void it('isRetiredName knows old commands and options by their command', () => {
    assert.equal(isRetiredName('', 'gone', TABLE), true);
    assert.equal(isRetiredName('grp', 'moved', TABLE), true);
    assert.equal(isRetiredName('run', '--old-name', TABLE), true);
    assert.equal(isRetiredName('', '--old-name', TABLE), false);
    assert.equal(isRetiredName('', 'fresh', TABLE), false);
  });

  void it('a typo near an old command name never suggests it', () => {
    const names = currentSubcommands(buildProgram()).map((command) => command.name());
    assert.deepEqual(findSimilarCommands('tial', names), []);
    assert.deepEqual(findSimilarCommands('staus', names), ['status']);
  });

  void it('spelling puts a root option after the start URL', () => {
    const spellings = RENAMES.map((entry) => spelling(entry, 'old'));
    assert.ok(spellings.includes('bdg tail'));
    assert.ok(spellings.includes('bdg <url> --compact'));
    assert.ok(spellings.includes('bdg cleanup --aggressive'));
  });
});

void describe('command rows of the real table', () => {
  const program = buildProgram();
  const commandRows = RENAMES.filter((entry) => entry.kind === 'command');

  void it('an old command path differs from its new one', () => {
    for (const entry of commandRows) {
      assert.notEqual(
        [entry.command, entry.old].filter(Boolean).join(' '),
        entry.new,
        spelling(entry, 'old')
      );
    }
  });

  void it('a deprecated old command is registered and hidden from help', () => {
    for (const entry of commandRows.filter((row) => row.stage === 'deprecated')) {
      const parent = entry.command
        .split(' ')
        .filter(Boolean)
        .reduce<Command>((command, word) => {
          const sub = command.commands.find((candidate) => candidate.name() === word);
          assert.ok(sub, `${word} is registered`);
          return sub;
        }, program);
      assert.ok(
        parent.commands.some((command) => command.name() === entry.old),
        `${spelling(entry, 'old')} is registered`
      );
      const visible = program.createHelp().visibleCommands(parent);
      assert.ok(
        !visible.some((command) => command.name() === entry.old),
        `${spelling(entry, 'old')} is hidden`
      );
    }
  });
});

void describe('CLI reference', () => {
  void it('lists every rename table entry with its stage', () => {
    const reference = fs.readFileSync('docs/CLI_REFERENCE.md', 'utf8');
    const section = reference.split('### Renamed and deprecated names')[1]?.split('\n## ')[0];
    assert.ok(section, 'docs/CLI_REFERENCE.md has a "Renamed and deprecated names" section');
    const rows = section.split('\n').filter((line) => line.startsWith('| `bdg'));
    assert.equal(rows.length, RENAMES.length, 'one row per entry');
    for (const entry of RENAMES) {
      const row = rows.find((line) => line.startsWith(`| \`${spelling(entry, 'old')}\` |`));
      assert.ok(row, `row for ${spelling(entry, 'old')}`);
      assert.ok(row.includes(entry.stage), `${spelling(entry, 'old')} is ${entry.stage}`);
    }
  });
});
