/**
 * Ctrl-C or SIGTERM while a file is being written (#678): the command exits
 * 130 or 143 as before, the target keeps its old content, and no temp file
 * is left next to it. Each case runs the write in a child process
 * (`src/__testutils__/interruptedWrite.ts`) with the rename held open, so the
 * signal always lands between the write of the temp file and its rename.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** The child script */
const CHILD = path.resolve('src/__testutils__/interruptedWrite.ts');

/** Content of the target before the write */
const OLD_CONTENT = 'old content';

/** Writers the child can use */
const WRITERS = ['text', 'buffer', 'safe'] as const;

/** Signals and their exit codes */
const SIGNALS = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const;

/**
 * Run the child, send the signal once the rename is held (and once more after
 * the abort, for the `abort` handler), and wait for it to exit.
 *
 * @param writer - Writer the child uses
 * @param handler - Interrupt handling of the child
 * @param signal - Signal to send
 * @param target - File to write
 * @returns Exit code of the child
 */
function interruptWrite(
  writer: string,
  handler: 'report' | 'abort',
  signal: NodeJS.Signals,
  target: string
): Promise<number | null> {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, writer, handler, target], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (chunk.includes('waiting') || chunk.includes('aborted')) child.kill(signal);
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

void describe('an interrupted file write (#678)', () => {
  after(removeTempDirs);

  for (const writer of WRITERS) {
    for (const [signal, exitCode] of SIGNALS) {
      for (const handler of ['report', 'abort'] as const) {
        const which = handler === 'report' ? 'first' : 'second';
        void it(`${writer}: the ${which} ${signal} exits ${exitCode} and leaves no temp file`, async () => {
          const dir = makeTempDir('bdg-interrupted-write-');
          const target = path.join(dir, 'out.json');
          fs.writeFileSync(target, OLD_CONTENT);

          const code = await interruptWrite(writer, handler, signal, target);

          assert.equal(code, exitCode);
          assert.deepEqual(fs.readdirSync(dir), ['out.json']);
          assert.equal(fs.readFileSync(target, 'utf8'), OLD_CONTENT);
        });
      }
    }
  }
});
