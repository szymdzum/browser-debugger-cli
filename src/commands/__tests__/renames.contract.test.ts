/**
 * Contract test (#465): old spellings from the rename table, run through the
 * CLI with no session. A deprecated one works as before with exactly one
 * warning (a `Warning:` line on stderr, or `warnings` in the `--json`
 * envelope and nothing on stderr); a removed one exits 81 naming what to do
 * instead; a name that is not in the table keeps today's path and never gets
 * an old spelling suggested; an old name as an argument value is left alone.
 * Help (text and `--help --json`) lists no old spelling.
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
 * The `Warning:` lines of stderr.
 *
 * @param stderr - Standard error
 * @returns Warning lines
 */
function warningLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('Warning: '));
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

const TAIL = '"bdg tail" is deprecated and will be removed in 1.0: use "bdg peek --follow"';
const AGGRESSIVE =
  '"bdg cleanup --aggressive" is deprecated and will be removed in 1.0: use "bdg cleanup --force"';
const KILL_CHROME =
  '"bdg stop --kill-chrome" is deprecated and will be removed in 1.0: bdg stop already closes the Chrome bdg launched; drop the flag';

interface DeprecatedRow {
  argv: string[];
  exit: number;
  warning: string;
}

const DEPRECATED: DeprecatedRow[] = [
  { argv: ['tail'], exit: EXIT_CODES.RESOURCE_NOT_FOUND, warning: TAIL },
  { argv: ['cleanup', '--aggressive'], exit: EXIT_CODES.SUCCESS, warning: AGGRESSIVE },
  { argv: ['stop', '--kill-chrome'], exit: EXIT_CODES.RESOURCE_NOT_FOUND, warning: KILL_CHROME },
];

interface RemovedRow {
  argv: string[];
  error: string;
  suggestion: string;
}

const REMOVED: RemovedRow[] = [
  {
    argv: ['http://localhost:1', '--compact'],
    error: '"bdg <url> --compact" was removed',
    suggestion: 'It had no effect; drop the flag',
  },
  {
    argv: ['cleanup', '--remove-output'],
    error: '"bdg cleanup --remove-output" was removed',
    suggestion: 'bdg no longer writes session.json; drop the flag',
  },
];

void describe('deprecated spellings', () => {
  for (const row of DEPRECATED) {
    const label = `bdg ${row.argv.join(' ')}`;

    void it(`${label}: works, one warning line on stderr`, async () => {
      const run = await runCli(row.argv);
      assert.equal(run.status, row.exit, run.stderr);
      assert.deepEqual(warningLines(run.stderr), [`Warning: ${row.warning}`]);
      assert.ok(!run.stderr.includes('Note: "bdg tail"'), 'no second notice');
    });

    void it(`${label} --json: warnings in the envelope, nothing on stderr`, async () => {
      const run = await runCli([...row.argv, '--json']);
      assert.equal(run.status, row.exit, run.stderr);
      assert.deepEqual(envelope(run.stdout)['warnings'], [row.warning]);
      assert.ok(!run.stderr.includes('deprecated'), run.stderr);
    });
  }
});

void describe('removed spellings', () => {
  for (const row of REMOVED) {
    const label = `bdg ${row.argv.join(' ')}`;

    void it(`${label}: exit 81 with what to do instead`, async () => {
      const run = await runCli(row.argv);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      assert.ok(run.stderr.includes(row.error), run.stderr);
      assert.ok(run.stderr.includes(row.suggestion), run.stderr);
      assert.deepEqual(warningLines(run.stderr), []);
    });

    void it(`${label} --json: error envelope, no warnings field`, async () => {
      const run = await runCli([...row.argv, '--json']);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      const response = envelope(run.stdout);
      assert.equal(response.success, false);
      assert.equal(response.error, row.error);
      assert.equal(response.suggestion, row.suggestion);
      assert.equal(response.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
      assert.ok(!('warnings' in response));
      assert.equal(run.stderr, '');
    });
  }
});

void describe('names not in the table', () => {
  void it('bdg cleanup --json: no warnings field', async () => {
    const run = await runCli(['cleanup', '--json']);
    assert.equal(run.status, EXIT_CODES.SUCCESS, run.stderr);
    assert.ok(!('warnings' in envelope(run.stdout)));
  });

  void it('bdg cleanup --force: no warning line', async () => {
    const run = await runCli(['cleanup', '--force']);
    assert.equal(run.status, EXIT_CODES.SUCCESS, run.stderr);
    assert.deepEqual(warningLines(run.stderr), []);
  });

  void it('bdg tial: unknown command, never "Did you mean: bdg tail"', async () => {
    const run = await runCli(['tial']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(run.stderr.includes('Unknown command: "tial"'), run.stderr);
    assert.ok(!run.stderr.includes('tail'), run.stderr);
  });

  void it('bdg tial --json: error envelope without an old spelling', async () => {
    const run = await runCli(['tial', '--json']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    const response = envelope(run.stdout);
    assert.ok(!JSON.stringify(response).includes('tail'), run.stdout);
    assert.ok(!('warnings' in response));
  });

  void it('bdg cleanup --agressive: the suggestion is --force-like, never --aggressive', async () => {
    const run = await runCli(['cleanup', '--agressive', '--json']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!JSON.stringify(envelope(run.stdout)).includes('--aggressive'), run.stdout);
  });
});

void describe('old names as argument values', () => {
  for (const argv of [
    ['eval', 'tail', '--json'],
    ['dom', 'fill', 'input', '--json', '--', '--aggressive'],
    ['eval', '--json', '--', '--kill-chrome'],
  ]) {
    void it(`bdg ${argv.join(' ')}: no warning, no warnings field`, async () => {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stdout + run.stderr);
      assert.ok(!('warnings' in envelope(run.stdout)), run.stdout);
      assert.ok(!run.stderr.includes('deprecated'), run.stderr);
    });
  }
});

void describe('help lists no old spelling', () => {
  const OLD_OPTIONS = ['--aggressive', '--kill-chrome', '--compact', '--remove-output'];

  void it('bdg --help, bdg cleanup --help, bdg stop --help', async () => {
    for (const argv of [['--help'], ['cleanup', '--help'], ['stop', '--help']]) {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.SUCCESS);
      assert.ok(!/^\s+tail\b/m.test(run.stdout), `${argv.join(' ')} lists tail`);
      for (const flag of OLD_OPTIONS) assert.ok(!run.stdout.includes(flag), flag);
    }
  });

  void it('bdg --help --json (compact and --full)', () => {
    const program = buildProgram();
    for (const help of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(help);
      assert.ok(!text.includes('"name":"tail"'), 'tail command listed');
      for (const flag of OLD_OPTIONS) assert.ok(!text.includes(flag), `${flag} listed`);
    }
  });
});
