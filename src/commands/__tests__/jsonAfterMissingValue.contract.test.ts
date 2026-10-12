/**
 * Contract test (#669): `--json` typed right after an option that takes a
 * value is never silently read as that value. Every value-taking option of
 * every command, followed by `--json`, gives one JSON envelope on stdout
 * (exit 81, with a suggestion) and nothing on stderr.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import type { Command } from 'commander';

import { buildProgram } from '@/program.js';
import type { BdgResponse } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface Row {
  label: string;
  argv: string[];
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const START_URL = 'http://localhost:1';
const BATCH_SIZE = 8;

/**
 * Run the CLI from source in an isolated session dir.
 *
 * @param argv - Arguments after `bdg`
 * @returns Exit status and both streams
 */
function runCli(argv: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const env = { ...process.env, BDG_SESSION_DIR: '/tmp/bdg-669-contract' };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...argv], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * One dummy value per required positional argument of a command.
 *
 * @param command - Command to satisfy
 * @returns Dummy arguments
 */
function dummyArguments(command: Command): string[] {
  return command.registeredArguments.filter((arg) => arg.required).map(() => 'x');
}

/**
 * Every value-taking option of the root and of each leaf command, as a
 * command line ending `<option> --json`.
 *
 * @param command - Command to walk
 * @param path - Command words leading to it
 * @returns Case rows
 */
function collectRows(command: Command, path: string[] = []): Row[] {
  const isRoot = path.length === 0;
  const isLeaf = command.commands.length === 0;
  const rows: Row[] = [];
  if (isRoot || isLeaf) {
    const base = isRoot ? [START_URL] : [...path, ...dummyArguments(command)];
    for (const option of command.options) {
      if (!option.required) continue;
      for (const flag of [option.long, option.short]) {
        if (flag === undefined) continue;
        rows.push({
          label: `${path.join(' ') || 'start'} ${flag} --json`,
          argv: [...base, flag, '--json'],
        });
      }
    }
  }
  for (const sub of command.commands) rows.push(...collectRows(sub, [...path, sub.name()]));
  return rows;
}

/**
 * Parse stdout as the single JSON envelope it must be.
 *
 * @param run - CLI run
 * @returns The envelope
 */
function envelopeOf(run: Run): BdgResponse<unknown> {
  return JSON.parse(run.stdout) as BdgResponse<unknown>;
}

void describe('--json right after an option that takes a value (#669)', () => {
  const rows = collectRows(
    buildProgram({
      writeOut: () => undefined,
      writeErr: () => undefined,
      outputError: () => undefined,
    })
  );

  void it('issue reproduction: network list --last --json and console --last --json', async () => {
    for (const argv of [
      ['network', 'list', '--last', '--json'],
      ['console', '--last', '--json'],
    ]) {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, argv.join(' '));
      const envelope = envelopeOf(run);
      assert.equal(envelope.success, false);
      assert.equal(typeof (envelope as { suggestion?: unknown }).suggestion, 'string');
      assert.equal(run.stderr, '', argv.join(' '));
    }
  });

  void it('literal rows, written by hand', async () => {
    for (const [argv, option] of [
      [['network', 'list', '--last', '--json'], '--last'],
      [['console', '--last', '--json'], '--last'],
      [['http://localhost:1', '--port', '--json'], '--port'],
      [['http://localhost:1', '-p', '--json'], '-p'],
      [['peek', '-j', '--last', '-j'], '--last'],
    ] as [string[], string][]) {
      const run = await runCli(argv);
      assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, argv.join(' '));
      assert.match(envelopeOf(run).error ?? '', new RegExp(`Option ${option} needs a value`));
      assert.equal(run.stderr, '');
    }
  });

  void it('a value-taking option swallows the next word: --filter --last --json', async () => {
    const run = await runCli(['network', 'list', '--filter', '--last', '--json']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(envelopeOf(run).error ?? '', /Invalid filter format: "--last"/);
  });

  void it('the short-flag suggestion names the long form', async () => {
    const run = await runCli(['http://localhost:1', '-p', '--json']);
    const { suggestion = '' } = envelopeOf(run) as { suggestion?: string };
    assert.match(suggestion, /--port=--json/);
    assert.doesNotMatch(suggestion, /-p=/);
  });

  void it('sweep: every value-taking option followed by --json gives an envelope', async () => {
    assert.ok(rows.length > 100, `expected the full matrix, got ${rows.length} rows`);
    const failures: string[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const runs = await Promise.all(batch.map((row) => runCli(row.argv)));
      runs.forEach((run, index) => {
        const label = batch[index]?.label ?? '?';
        try {
          assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS);
          const envelope = envelopeOf(run) as { success: boolean; suggestion?: string };
          assert.equal(envelope.success, false);
          assert.equal(typeof envelope.suggestion, 'string');
          assert.equal(run.stderr, '');
        } catch {
          failures.push(`${label} (exit ${String(run.status)}, stderr ${run.stderr.length} bytes)`);
        }
      });
    }
    assert.deepEqual(failures, [], `${failures.length} of ${rows.length} rows failed`);
  });

  void it('--last=--json (value attached) without the flag stays a human usage error', async () => {
    const run = await runCli(['network', 'list', '--last=--json']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /Invalid --last/);
  });

  void it('a --json that is its own flag after a complete value is unchanged', async () => {
    const run = await runCli(['network', 'list', '--last', '5', '--json']);
    assert.equal(run.status, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.equal(envelopeOf(run).success, false);
    assert.equal(run.stderr, '');
  });

  void it('--json inside a value or attached with = is a value, not a missing one', async () => {
    const inside = await runCli(['cdp', 'Runtime.evaluate', '--params', '{"--json":1}', '--json']);
    assert.equal(inside.status, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.doesNotMatch(inside.stdout, /needs a value/);

    const attached = await runCli(['network', 'list', '--last=--json', '--json']);
    assert.equal(attached.status, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(envelopeOf(attached).error ?? '', /Invalid --last/);
    assert.equal(attached.stderr, '');
  });
});
