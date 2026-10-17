/**
 * Parse-level cells of the #465 D7, D8 and D9 matrix, on the real command
 * tree: the options an action gets after `applyRenamedNames`, and the
 * warnings. Old `--timeout`/`-t` (root, `attach`) reach `stopAfter`, old
 * `-a`/`--all` reach `captureAll`, old `cleanup -f`/`--aggressive` reach
 * `force`; each old spelling warns once, a new one never, and an old and a
 * new spelling of the same option together exit 81 when their values differ,
 * and pass with the old spelling's warning when they agree. `dom` commands keep
 * their own `--all` without a warning. The human and `--json` reporting of
 * the warnings is in `stopAfterCaptureAll.contract.test.ts`.
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
import { CommandError } from '@/errors/index.js';
import { buildProgram } from '@/program.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
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
 * @throws CommandError (81) for a removed or conflicting spelling
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

const STOP_AFTER_OLD = '"bdg <url> --timeout" is deprecated and will be removed in 1.0';
const ATTACH_OLD = '"bdg attach --timeout" is deprecated and will be removed in 1.0';

interface Cell {
  name: string;
  argv: string[];
  command: string;
  expected: Record<string, unknown>;
  warning?: string;
}

const CELLS: Cell[] = [
  {
    name: 'root --stop-after',
    argv: [URL_ARG, '--stop-after', '5'],
    command: '',
    expected: { stopAfter: '5' },
  },
  {
    name: 'root --timeout',
    argv: [URL_ARG, '--timeout', '5'],
    command: '',
    expected: { stopAfter: '5' },
    warning: `${STOP_AFTER_OLD}: use "bdg <url> --stop-after"`,
  },
  {
    name: 'root -t',
    argv: [URL_ARG, '-t', '5'],
    command: '',
    expected: { stopAfter: '5' },
    warning: `${STOP_AFTER_OLD}: use "bdg <url> --stop-after"`,
  },
  {
    name: 'attach --stop-after',
    argv: ['attach', '0', '--stop-after', '5'],
    command: 'attach',
    expected: { stopAfter: '5' },
  },
  {
    name: 'attach --timeout',
    argv: ['attach', '0', '--timeout', '5'],
    command: 'attach',
    expected: { stopAfter: '5' },
    warning: `${ATTACH_OLD}: use "bdg attach --stop-after"`,
  },
  {
    name: 'root --capture-all',
    argv: [URL_ARG, '--capture-all'],
    command: '',
    expected: { captureAll: true },
  },
  {
    name: 'root --all',
    argv: [URL_ARG, '--all'],
    command: '',
    expected: { captureAll: true },
    warning:
      '"bdg <url> --all" is deprecated and will be removed in 1.0: use "bdg <url> --capture-all"',
  },
  {
    name: 'root -a',
    argv: [URL_ARG, '-a'],
    command: '',
    expected: { captureAll: true },
    warning:
      '"bdg <url> --all" is deprecated and will be removed in 1.0: use "bdg <url> --capture-all"',
  },
  {
    name: 'cleanup --force',
    argv: ['cleanup', '--force'],
    command: 'cleanup',
    expected: { force: true },
  },
  {
    name: 'cleanup -f',
    argv: ['cleanup', '-f'],
    command: 'cleanup',
    expected: { force: true },
    warning: '"bdg cleanup -f" is deprecated and will be removed in 1.0: use "bdg cleanup --force"',
  },
  {
    name: 'cleanup --aggressive',
    argv: ['cleanup', '--aggressive'],
    command: 'cleanup',
    expected: { force: true },
    warning:
      '"bdg cleanup --aggressive" is deprecated and will be removed in 1.0: use "bdg cleanup --force"',
  },
];

void describe('stop-after, capture-all and cleanup -f rows (#465 D7, D8, D9)', () => {
  for (const cell of CELLS) {
    void it(`${cell.name}: takes effect, ${cell.warning ? 'warns once' : 'no warning'}`, async () => {
      const parsed = await parse(cell.argv);
      assert.equal(parsed.command, cell.command);
      for (const [key, value] of Object.entries(cell.expected)) {
        assert.equal(parsed.opts[key], value, `${key} of ${JSON.stringify(parsed.opts)}`);
      }
      assert.deepEqual(parsed.warnings, cell.warning ? [cell.warning] : []);
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

  void it('--stop-after with an old --timeout of another value exits 81', async () => {
    for (const argv of [
      [URL_ARG, '--stop-after', '7', '-t5'],
      [URL_ARG, '-t5', '--stop-after', '7'],
      ['attach', '0', '--timeout', '9', '--stop-after', '5'],
    ]) {
      await assert.rejects(parse(argv), (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
        assert.match(
          error.message,
          /"bdg (<url>|attach) --timeout" and "bdg (<url>|attach) --stop-after"/
        );
        return true;
      });
    }
  });

  void it('an old and a new spelling with the same value pass, with the old one warning', async () => {
    const cells: [string[], Record<string, unknown>, number][] = [
      [[URL_ARG, '-t', '5', '--stop-after', '5'], { stopAfter: '5' }, 1],
      [[URL_ARG, '-a', '--capture-all'], { captureAll: true }, 1],
      [['cleanup', '--aggressive', '--force'], { force: true }, 1],
      [['cleanup', '--force', '-f'], { force: true }, 1],
      [['cleanup', '--aggressive', '-f'], { force: true }, 2],
    ];
    for (const [argv, expected, warnings] of cells) {
      const parsed = await parse(argv);
      for (const [key, value] of Object.entries(expected)) assert.equal(parsed.opts[key], value);
      assert.equal(parsed.warnings.length, warnings, argv.join(' '));
    }
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
