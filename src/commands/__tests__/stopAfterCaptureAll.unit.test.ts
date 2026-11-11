/**
 * Parse-level cells of the #465 D7, D8 and D9 matrix, on the real command
 * tree: the options an action gets after `applyRenamedNames`. `--stop-after`
 * (root, `attach`), `--capture-all` and `cleanup --force` take effect with no
 * warning, `dom` commands keep their own `--all`, and help and typo
 * suggestions list no old spelling (removed in 1.0: their exit 81 is in
 * `renames.contract.test.ts`). A deprecated short-only row is checked on a
 * toy table.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Command } from 'commander';

import {
  applyRenamedNames,
  commandWords,
  currentOptions,
  registerRenamedNames,
} from '@/commands/shared/renamedNames.js';
import { buildProgram } from '@/program.js';
import { spelling, type RenameEntry } from '@/utils/renames.js';

interface Parsed {
  command: string;
  opts: Record<string, unknown>;
  warnings: string[];
}

class Stop extends Error {}

/**
 * Parse a command line on the real program up to the action, which never runs.
 *
 * @param argv - Arguments after `bdg`
 * @returns The command, its options after the rename step, and the warnings
 * @throws CommandError (81) for a removed spelling
 */
async function parse(argv: string[]): Promise<Parsed> {
  const program = buildProgram();
  let parsed: Parsed | undefined;
  program.hook('preAction', (_root, actionCommand) => {
    const warnings = applyRenamedNames(actionCommand);
    parsed = { command: commandWords(actionCommand), opts: actionCommand.opts(), warnings };
    throw new Stop();
  });
  try {
    await program.parseAsync(['node', 'bdg', ...argv]);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
  }
  assert.ok(parsed, `bdg ${argv.join(' ')} reached no action`);
  return parsed;
}

const URL_ARG = 'http://localhost:3000';

interface Cell {
  name: string;
  argv: string[];
  command: string;
  expected: Record<string, unknown>;
}

const CELLS: Cell[] = [
  {
    name: 'root --stop-after',
    argv: [URL_ARG, '--stop-after', '5'],
    command: '',
    expected: { stopAfter: '5' },
  },
  {
    name: 'attach --stop-after',
    argv: ['attach', '0', '--stop-after', '5'],
    command: 'attach',
    expected: { stopAfter: '5' },
  },
  {
    name: 'root --capture-all',
    argv: [URL_ARG, '--capture-all'],
    command: '',
    expected: { captureAll: true },
  },
  {
    name: 'cleanup --force',
    argv: ['cleanup', '--force'],
    command: 'cleanup',
    expected: { force: true },
  },
];

void describe('stop-after, capture-all and cleanup --force (#465 D7, D8, D9)', () => {
  for (const cell of CELLS) {
    void it(`${cell.name}: takes effect, no warning`, async () => {
      const parsed = await parse(cell.argv);
      assert.equal(parsed.command, cell.command);
      for (const [key, value] of Object.entries(cell.expected)) {
        assert.equal(parsed.opts[key], value, `${key} of ${JSON.stringify(parsed.opts)}`);
      }
      assert.deepEqual(parsed.warnings, []);
    });
  }

  void it('dom commands keep their own --all without a warning', async () => {
    for (const argv of [
      ['dom', 'get', '0', '--all'],
      ['dom', 'listeners', 'body', '--all'],
    ]) {
      const parsed = await parse(argv);
      assert.equal(parsed.opts['all'], true, argv.join(' '));
      assert.deepEqual(parsed.warnings, [], argv.join(' '));
    }
  });

  void it('help and typo suggestions list the new spellings only', () => {
    const program = buildProgram();
    const longs = (command: Command): (string | undefined)[] =>
      currentOptions(command).map((option) => option.long ?? option.short);
    const cleanup = program.commands.find((command) => command.name() === 'cleanup');
    const attach = program.commands.find((command) => command.name() === 'attach');
    assert.ok(cleanup && attach);
    assert.ok(longs(program).includes('--stop-after'));
    assert.ok(longs(program).includes('--capture-all'));
    assert.ok(longs(attach).includes('--stop-after'));
    for (const old of ['--timeout', '--all']) assert.ok(!longs(program).includes(old), old);
    assert.ok(!longs(attach).includes('--timeout'));
    assert.ok(longs(cleanup).includes('--force'));
    assert.ok(!longs(cleanup).includes('-f'));
  });
});

void describe('a short-only row (#465 D8)', () => {
  const table: readonly RenameEntry[] = [
    { kind: 'option', command: 'run', old: '-f', new: '--force', stage: 'deprecated' },
  ];

  /**
   * A toy `run --force` command with the short-only row registered.
   *
   * @returns The program, and the options `run` last got
   */
  function toyProgram(): { program: Command; got: Record<string, unknown>[] } {
    const got: Record<string, unknown>[] = [];
    const program = new Command('bdg').exitOverride();
    program
      .command('run')
      .option('--force', 'Force')
      .action((opts: Record<string, unknown>) => {
        got.push(opts);
      });
    registerRenamedNames(program, table);
    return { program, got };
  }

  void it('registers -f as a hidden option that reaches --force, with the warning', async () => {
    const { program, got } = toyProgram();
    const warnings: string[] = [];
    program.hook('preAction', (_root, actionCommand) => {
      warnings.push(...applyRenamedNames(actionCommand, table));
    });
    await program.parseAsync(['node', 'bdg', 'run', '-f']);
    assert.equal(got[0]?.['force'], true);
    assert.deepEqual(warnings, [
      '"bdg run -f" is deprecated and will be removed in 1.0: use "bdg run --force"',
    ]);
    const [entry] = table;
    assert.ok(entry);
    assert.equal(spelling(entry, 'old'), 'bdg run -f');
  });

  void it('leaves -f out of help and suggestions', () => {
    const { program } = toyProgram();
    const run = program.commands.find((command) => command.name() === 'run');
    assert.ok(run);
    assert.ok(run.options.some((option) => option.short === '-f'));
    assert.ok(run.helpInformation().includes('--force'));
    assert.doesNotMatch(run.helpInformation(), /(^|\s)-f[,\s]/);
  });
});
