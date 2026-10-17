/**
 * Contract test (#465, D1): `dom get --nth` is a deprecated spelling of
 * `--index`: it behaves as `--index` plus one warning (a `Warning:` line on
 * stderr, `warnings` in the `--json` envelope); the table's conflict rule
 * applies; help lists only `--index`. Run with no session.
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
 * @returns Lines
 */
function warningLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('Warning: '));
}

const NTH_WARNING =
  '"bdg dom get --nth" is deprecated and will be removed in 1.0: use "bdg dom get --index"';

void describe('dom get --nth is a deprecated spelling of --index', () => {
  void it('--index 1: no warning', async () => {
    const run = await runCli(['dom', 'get', 'h1', '--index', '1']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.equal(warningLines(run.stderr).length, 0, run.stderr);
  });

  void it('--nth 1: same exit and output as --index 1, one warning line', async () => {
    const [current, old] = await Promise.all([
      runCli(['dom', 'get', 'h1', '--index', '1']),
      runCli(['dom', 'get', 'h1', '--nth', '1']),
    ]);
    assert.equal(old.status, current.status, old.stderr);
    assert.equal(old.stdout, current.stdout);
    assert.deepEqual(warningLines(old.stderr), [`Warning: ${NTH_WARNING}`]);
  });

  void it('--nth 1 --json: warnings in the envelope, nothing on stderr', async () => {
    const run = await runCli(['dom', 'get', 'h1', '--nth', '1', '--json']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.deepEqual(envelope(run.stdout)['warnings'], [NTH_WARNING]);
    assert.equal(run.stderr, '');
  });

  void it('--nth 1 --index 1: the same value passes, with the warning', async () => {
    const run = await runCli(['dom', 'get', 'h1', '--nth', '1', '--index', '1']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.deepEqual(warningLines(run.stderr), [`Warning: ${NTH_WARNING}`]);
  });

  void it('--nth 1 --index 2: conflicting values exit 81 with the table message', async () => {
    const run = await runCli(['dom', 'get', 'h1', '--nth', '1', '--index', '2']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!run.stderr.includes('unknown option'), run.stderr);
    assert.ok(run.stderr.includes('"bdg dom get --nth"'), run.stderr);
    assert.ok(run.stderr.includes('--index'), run.stderr);
  });

  void it('help, --help --json and typo suggestions do not list --nth', async () => {
    const help = await runCli(['dom', 'get', '--help']);
    assert.ok(help.stdout.includes('--index <n>'), help.stdout);
    assert.ok(!help.stdout.includes('--nth'), help.stdout);
    const program = buildProgram();
    for (const json of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      assert.ok(!JSON.stringify(json).includes('--nth'), '--nth listed');
    }
    const typo = await runCli(['dom', 'get', 'h1', '--nht', '1']);
    assert.equal(typo.status, EXIT_CODES.INVALID_ARGUMENTS, typo.stderr);
    assert.ok(!typo.stderr.includes('--nth'), typo.stderr);
  });
});
