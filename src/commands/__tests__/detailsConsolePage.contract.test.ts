/**
 * Contract test (#465, D6 and D11): `bdg network details <id>` and
 * `bdg console details <n>` are the commands and `bdg console --page
 * current|all` the page scope; `bdg details …` and `-H/--history` were
 * removed in 1.0 (their exit 81 is in `renames.contract.test.ts`). Run with
 * no session. Help, `--help --json` and typo suggestions list no `details`
 * command and no `-H`.
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

const CURRENT: string[][] = [
  ['network', 'details', 'abc'],
  ['console', 'details', '0'],
  ['console', '--page', 'all'],
];

void describe('the new spellings', () => {
  for (const argv of CURRENT) {
    void it(`bdg ${argv.join(' ')}: no unknown command or option, no warning`, async () => {
      const run = await runCli(argv);
      assert.ok(!run.stderr.includes('unknown'), run.stderr);
      assert.ok(!run.stderr.includes('Warning:'), run.stderr);
    });
  }
});

void describe('options given to console before details', () => {
  void it('console --json details 0 answers with the --json envelope', async () => {
    const before = await runCli(['console', '--json', 'details', '0']);
    const after = await runCli(['console', 'details', '0', '--json']);
    assert.equal(before.status, after.status, before.stderr);
    assert.deepEqual(envelope(before.stdout), envelope(after.stdout));
  });
});

void describe('--include-sensitive on console details', () => {
  void it('is refused, also when given before details', async () => {
    for (const argv of [
      ['console', 'details', '0', '--include-sensitive'],
      ['console', '--include-sensitive', 'details', '0'],
    ]) {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      assert.match(run.stderr, /--include-sensitive applies to network requests only/);
    }
  });

  void it('is not turned on by inheritance when it was not given', async () => {
    const run = await runCli(['console', '--json', 'details', '0']);
    assert.ok(!run.stdout.includes('applies to network requests only'), run.stdout);
    assert.notEqual(envelope(run.stdout).exitCode, EXIT_CODES.INVALID_ARGUMENTS);
  });
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
