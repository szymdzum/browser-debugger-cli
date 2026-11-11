/**
 * Contract test (#465, D1): `dom get --index` takes no warning, and help
 * and typo suggestions never offer the removed `--nth` (its exit 81 is in
 * `renames.contract.test.ts`). Run with no session.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import { generateCompactHelp, generateMachineReadableHelp } from '@/commands/helpJson.js';
import { buildProgram } from '@/program.js';
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
 * @returns Lines
 */
function warningLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('Warning: '));
}

void describe('dom get --index, --nth removed (1.0)', () => {
  void it('--index 1: no warning', async () => {
    const run = await runCli(['dom', 'get', 'h1', '--index', '1']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.equal(warningLines(run.stderr).length, 0, run.stderr);
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
