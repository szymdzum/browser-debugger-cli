/**
 * Contract test (#465, #844): old spellings from the rename table, run
 * through the CLI with no session. Since 1.0 every row is removed: its long
 * and short forms exit 81 naming what to do instead, an old option's value
 * is consumed (the error is about the rename), and no session is started; a
 * name that is not in the table keeps today's path and never gets an old
 * spelling suggested; an old name as an argument value is left alone. Help
 * (text and `--help --json`) lists no old spelling. The deprecated stage is
 * covered on an injected table (`renamedNames.unit.test.ts`).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

interface RemovedRow {
  argv: string[];
  error: string;
  suggestion: string;
}

/**
 * A removed rename row: exit 81 with "renamed to" and "Use" naming the new spelling.
 *
 * @param argv - Command line with the old spelling
 * @param oldSpelling - Old spelling as the error names it
 * @param newSpelling - New spelling
 * @returns Row
 */
function renamed(argv: string[], oldSpelling: string, newSpelling: string): RemovedRow {
  return {
    argv,
    error: `"${oldSpelling}" was renamed to "${newSpelling}"`,
    suggestion: `Use "${newSpelling}"`,
  };
}

const URL_ARG = 'http://localhost:1';
const STOP_AFTER = 'bdg <url> --stop-after <seconds>';
const DETAILS_HINT = 'use "bdg network details <id>" or "bdg console details <n>"';

const REMOVED: RemovedRow[] = [
  {
    argv: [URL_ARG, '--compact'],
    error: '"bdg <url> --compact" was removed',
    suggestion: 'It had no effect; drop the flag',
  },
  {
    argv: ['cleanup', '--remove-output'],
    error: '"bdg cleanup --remove-output" was removed',
    suggestion: 'bdg no longer writes session.json; drop the flag',
  },
  renamed(['tail'], 'bdg tail', 'bdg peek --follow'),
  renamed(['tail', '--last', '5'], 'bdg tail', 'bdg peek --follow'),
  {
    argv: ['details', 'network', '3'],
    error: '"bdg details" was removed',
    suggestion: DETAILS_HINT,
  },
  {
    argv: ['details', 'console', '0'],
    error: '"bdg details" was removed',
    suggestion: DETAILS_HINT,
  },
  renamed(['network', 'document'], 'bdg network document', 'bdg network headers'),
  renamed(['dom', 'eval', 'document.title'], 'bdg dom eval', 'bdg eval'),
  renamed(['dom', 'pressKey', 'input', 'Enter'], 'bdg dom pressKey', 'bdg dom press-key'),
  renamed(['network', 'getCookies'], 'bdg network getCookies', 'bdg network cookies'),
  renamed(['cleanup', '--aggressive'], 'bdg cleanup --aggressive', 'bdg cleanup --force'),
  renamed(['cleanup', '-f'], 'bdg cleanup -f', 'bdg cleanup --force'),
  renamed([URL_ARG, '-t', '5'], 'bdg <url> --timeout', STOP_AFTER),
  renamed([URL_ARG, '--timeout', '5'], 'bdg <url> --timeout', STOP_AFTER),
  renamed([URL_ARG, '--timeout=5'], 'bdg <url> --timeout', STOP_AFTER),
  renamed(
    ['attach', '--timeout', '5'],
    'bdg attach --timeout',
    'bdg attach --stop-after <seconds>'
  ),
  renamed(['dom', 'audit', '--level', 'AAA'], 'bdg dom audit --level', 'bdg dom audit --wcag'),
  renamed(['dom', 'audit', '--level', 'bogus'], 'bdg dom audit --level', 'bdg dom audit --wcag'),
  renamed(['dom', 'get', '--nth', '2', 'a'], 'bdg dom get --nth', 'bdg dom get --index'),
  renamed([URL_ARG, '-a'], 'bdg <url> --all', 'bdg <url> --capture-all'),
  renamed([URL_ARG, '--all'], 'bdg <url> --all', 'bdg <url> --capture-all'),
  renamed(['console', '-H'], 'bdg console --history', 'bdg console --page all'),
  renamed(['console', '--history'], 'bdg console --history', 'bdg console --page all'),
  {
    argv: ['stop', '--kill-chrome'],
    error: '"bdg stop --kill-chrome" was removed',
    suggestion: 'bdg stop already closes the Chrome bdg launched; drop the flag',
  },
];

/**
 * Whether the session dir shows a daemon was started.
 *
 * @returns True when a daemon socket, PID file or log exists
 */
function daemonStarted(): boolean {
  return ['daemon.sock', 'daemon.pid', 'daemon.log', 'session.meta.json'].some((file) =>
    fs.existsSync(path.join(sessionDir, file))
  );
}

void describe('removed spellings', () => {
  for (const row of REMOVED) {
    const label = `bdg ${row.argv.join(' ')}`;

    void it(`${label}: exit 81 with what to do instead`, async () => {
      const run = await runCli(row.argv);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
      assert.ok(run.stderr.includes(row.error), run.stderr);
      assert.ok(run.stderr.includes(row.suggestion), run.stderr);
      assert.deepEqual(warningLines(run.stderr), []);
      assert.ok(!daemonStarted(), 'no session started');
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
  const OLD_OPTIONS = [
    '--aggressive',
    '--kill-chrome',
    '--compact',
    '--remove-output',
    '--nth',
    '--history',
  ];
  const OLD_IN_HELP_TEXT = [...OLD_OPTIONS, '--timeout', '-a, --all', '-H,', '-f,', '--level'];

  void it('bdg --help, bdg cleanup --help, bdg stop --help', async () => {
    for (const argv of [
      ['--help'],
      ['cleanup', '--help'],
      ['stop', '--help'],
      ['console', '--help'],
      ['dom', 'get', '--help'],
      ['dom', 'audit', '--help'],
      ['attach', '--help'],
    ]) {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.SUCCESS);
      assert.ok(!/^\s+tail\b/m.test(run.stdout), `${argv.join(' ')} lists tail`);
      assert.ok(!/^\s+details <type>/m.test(run.stdout), `${argv.join(' ')} lists details`);
      const old = argv[0] === 'console' ? OLD_OPTIONS : OLD_IN_HELP_TEXT;
      for (const flag of old) assert.ok(!run.stdout.includes(flag), `${argv.join(' ')}: ${flag}`);
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
