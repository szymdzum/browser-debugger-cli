/**
 * Contract test (#465, D5 and D12): `bdg network headers` (no id: the main
 * document) replaces `network document`, and `bdg dom audit --wcag AA|AAA`
 * replaces `--level`. The old spellings were removed in 1.0 (their exit 81
 * is in `renames.contract.test.ts`); help and typo suggestions list only the
 * new names. Run with no session.
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

void describe('network headers; network document removed', () => {
  void it('bdg network headers: no warning', async () => {
    const run = await runCli(['network', 'headers']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
    assert.equal(warningLines(run.stderr).length, 0, run.stderr);
    const json = await runCli(['network', 'headers', '--json']);
    assert.ok(!('warnings' in envelope(json.stdout)), json.stdout);
  });

  void it('network --help and --help --json list headers, not document', async () => {
    const network = await runCli(['network', '--help']);
    assert.match(network.stdout, /^\s+headers\b/m);
    assert.ok(!/^ {2}document\b/m.test(network.stdout), network.stdout);
    const program = buildProgram();
    for (const help of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(help);
      assert.ok(!text.includes('network document'), 'network document listed');
      assert.ok(!text.includes('"name":"document"'), 'document listed');
    }
  });

  void it('a typo of document never suggests the removed name', async () => {
    const run = await runCli(['network', 'documnt']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(!/network document/.test(run.stderr), run.stderr);
  });
});

void describe('dom audit --wcag; --level removed', () => {
  void it('--wcag aaa and AA parse; no warning', async () => {
    for (const value of ['aaa', 'AA']) {
      const run = await runCli(['dom', 'audit', '--wcag', value]);
      assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND, run.stderr);
      assert.equal(warningLines(run.stderr).length, 0, run.stderr);
      assert.ok(!run.stderr.includes('unknown option'), run.stderr);
    }
  });

  void it('--wcag bogus: exit 81, Use AA or AAA', async () => {
    const run = await runCli(['dom', 'audit', '--wcag', 'bogus']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.ok(run.stderr.includes('Use AA or AAA'), run.stderr);
  });

  void it('help lists --wcag and the example uses it, not --level', async () => {
    const help = await runCli(['dom', 'audit', '--help']);
    assert.ok(help.stdout.includes('--wcag <level>'), help.stdout);
    assert.ok(!help.stdout.includes('--level'), help.stdout);
    const program = buildProgram();
    for (const json of [generateCompactHelp(program), generateMachineReadableHelp(program)]) {
      const text = JSON.stringify(json);
      assert.ok(text.includes('--wcag'), '--wcag missing');
      assert.ok(!/audit[^"]*--level/.test(text), 'audit --level listed');
    }
  });
});
