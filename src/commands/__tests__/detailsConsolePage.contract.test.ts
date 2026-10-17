/**
 * Contract test (#465, D6 and D11): `bdg network details <id>` and
 * `bdg console details <n>` are the commands and `bdg details …` the
 * deprecated spelling; `bdg console --page current|all` is the page scope and
 * `-H/--history` the deprecated spelling of `--page all`. Run with no
 * session. Old spellings behave as the new ones plus one warning (a
 * `Warning:` line on stderr, `warnings` in the `--json` envelope, never for
 * the new spelling); help, `--help --json` and typo suggestions list no
 * `details` command and no `-H`.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import { generateCompactHelp, generateMachineReadableHelp } from '@/commands/helpJson.js';
import { buildProgram } from '@/program.js';
import type { BdgResponse } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const sessionDir = ensureTestSessionDir();

/**
 * Run the CLI from source in an empty session dir (no session).
 *
 * @param argv - Arguments after `bdg`
 * @returns Exit status and both streams
 */
function runCli(argv: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const env = { ...process.env, BDG_SESSION_DIR: sessionDir, CI: '1' };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...argv], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * The one envelope on stdout.
 *
 * @param stdout - Standard output
 * @returns Parsed envelope
 */
function envelope(stdout: string): BdgResponse & Record<string, unknown> {
  return JSON.parse(stdout.trim()) as BdgResponse & Record<string, unknown>;
}

/**
 * The `Warning:` lines of stderr.
 *
 * @param stderr - Standard error
 * @returns Warning lines
 */
function warningLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('Warning: '));
}

/**
 * Stderr without its `Warning:` lines.
 *
 * @param stderr - Standard error
 * @returns Remaining text
 */
function withoutWarnings(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !line.startsWith('Warning: '))
    .join('\n');
}

const DETAILS =
  '"bdg details" is deprecated and will be removed in 1.0: use "bdg network details <id>" or "bdg console details <n>"';
const HISTORY =
  '"bdg console --history" is deprecated and will be removed in 1.0: use "bdg console --page all"';

interface Rename {
  current: string[];
  old: string[];
  warning: string;
}

const RENAMED: Rename[] = [
  {
    current: ['network', 'details', 'abc'],
    old: ['details', 'network', 'abc'],
    warning: DETAILS,
  },
  { current: ['console', 'details', '0'], old: ['details', 'console', '0'], warning: DETAILS },
  { current: ['console', '--page', 'all'], old: ['console', '-H'], warning: HISTORY },
  { current: ['console', '--page', 'all'], old: ['console', '--history'], warning: HISTORY },
];

void describe('renamed spellings: new, old, human and --json', () => {
  for (const row of RENAMED) {
    const label = `bdg ${row.old.join(' ')}`;

    void it(`bdg ${row.current.join(' ')}: no unknown command or option, no warning`, async () => {
      const run = await runCli(row.current);
      assert.ok(!run.stderr.includes('unknown'), run.stderr);
      assert.ok(!run.stderr.includes('Warning:'), run.stderr);
    });

    void it(`${label}: same exit, output and stderr as the new one, one warning line`, async () => {
      const [current, old] = await Promise.all([runCli(row.current), runCli(row.old)]);
      assert.equal(old.status, current.status, old.stderr);
      assert.equal(old.stdout, current.stdout);
      assert.equal(withoutWarnings(old.stderr), current.stderr);
      assert.deepEqual(warningLines(old.stderr), [`Warning: ${row.warning}`]);
    });

    void it(`${label} --json: same envelope plus warnings, nothing on stderr`, async () => {
      const [current, old] = await Promise.all([
        runCli([...row.current, '--json']),
        runCli([...row.old, '--json']),
      ]);
      assert.equal(old.status, current.status, old.stderr);
      const newEnvelope = envelope(current.stdout);
      const { warnings, ...oldRest } = envelope(old.stdout);
      assert.ok(!('warnings' in newEnvelope), current.stdout);
      assert.deepEqual(warnings, [row.warning]);
      assert.deepEqual(oldRest, newEnvelope);
      assert.equal(old.stderr, '');
    });
  }
});

void describe('console --page', () => {
  void it('takes current and all in any case', async () => {
    const reference = await runCli(['console']);
    for (const value of ['current', 'all', 'ALL', 'Current']) {
      const run = await runCli(['console', '--page', value]);
      assert.equal(run.status, reference.status, `${value}: ${run.stderr}`);
      assert.ok(!run.stderr.includes('Warning:'), run.stderr);
    }
  });

  void it('rejects another value with exit 81 and a did-you-mean', async () => {
    const typo = await runCli(['console', '--page', 'al']);
    assert.equal(typo.status, EXIT_CODES.INVALID_ARGUMENTS, typo.stderr);
    assert.match(typo.stderr, /Use current or all \(did you mean all\?\)/);
    const bogus = await runCli(['console', '--page', 'bogus']);
    assert.equal(bogus.status, EXIT_CODES.INVALID_ARGUMENTS, bogus.stderr);
    assert.match(bogus.stderr, /Use current or all/);
  });

  void it('--page bogus --json: error envelope, exit 81', async () => {
    const run = await runCli(['console', '--page', 'bogus', '--json']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.equal(envelope(run.stdout).success, false);
  });

  void it('-H with --page current is a conflict (exit 81); -H with --page all is not', async () => {
    const conflict = await runCli(['console', '-H', '--page', 'current']);
    assert.equal(conflict.status, EXIT_CODES.INVALID_ARGUMENTS, conflict.stderr);
    assert.match(conflict.stderr, /--history cannot be combined with --page current/);
    const same = await runCli(['console', '-H', '--page', 'all']);
    assert.notEqual(same.status, EXIT_CODES.INVALID_ARGUMENTS, same.stderr);
  });

  void it('console --help lists --page and no -H or --history', async () => {
    const help = await runCli(['console', '--help']);
    assert.match(help.stdout, /--page <scope>/);
    assert.ok(!help.stdout.includes('--history'), help.stdout);
    assert.ok(!/-H\b/.test(help.stdout), help.stdout);
  });
});

void describe('help and suggestions list the new names only', () => {
  void it('bdg --help lists no details; network and console --help list it', async () => {
    const root = await runCli(['--help']);
    assert.ok(!/^\s+details\b/m.test(root.stdout), root.stdout);
    for (const group of ['network', 'console']) {
      const help = await runCli([group, '--help']);
      assert.match(help.stdout, /^\s+details\b/m);
    }
  });

  void it('bdg network details --help has the options details network had', async () => {
    const help = await runCli(['network', 'details', '--help']);
    assert.equal(help.status, EXIT_CODES.SUCCESS);
    for (const text of [
      '--body',
      '--no-body',
      '--body-max <chars>',
      '--include-sensitive',
      '-j, --json',
    ]) {
      assert.ok(help.stdout.includes(text), text);
    }
    const consoleHelp = await runCli(['console', 'details', '--help']);
    assert.ok(consoleHelp.stdout.includes('--include-sensitive'), consoleHelp.stdout);
    assert.ok(!consoleHelp.stdout.includes('--body'), consoleHelp.stdout);
  });

  void it('bdg --help --json (compact and full): no top-level details, no --history', () => {
    const program = buildProgram();
    for (const help of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(help);
      assert.ok(!text.includes('bdg details'), 'bdg details listed');
      assert.ok(!text.includes('--history'), '--history listed');
      assert.ok(!text.includes('"-H'), '-H listed');
      assert.ok(text.includes('network details'), 'network details missing');
      assert.ok(text.includes('console details'), 'console details missing');
      assert.ok(text.includes('--page'), '--page missing');
    }
  });

  void it('a typo near details never suggests the old top-level command', async () => {
    const run = await runCli(['detals', 'network', 'x']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!/Did you mean:? (bdg )?details/.test(run.stderr), run.stderr);
  });

  void it('a typo of --page suggests --page, never --history', async () => {
    const run = await runCli(['console', '--pag', 'all']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!run.stderr.includes('--history'), run.stderr);
  });
});

void describe('usage errors of an old spelling', () => {
  void it('bdg details bogus x: exit 81, the warning, usage names the new commands', async () => {
    const run = await runCli(['details', 'bogus', 'x']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.deepEqual(warningLines(run.stderr), [`Warning: ${DETAILS}`]);
    assert.match(run.stderr, /bdg network details <requestId>/);
    assert.ok(!withoutWarnings(run.stderr).includes('bdg details'), run.stderr);
  });
});
