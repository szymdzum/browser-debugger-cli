/**
 * Child process for the interrupted-write tests: writes a file through one of
 * the atomic writers with the rename held open (the temp file is complete and
 * waits to replace the target), under the CLI's interrupt handling, and says
 * on stdout where it is so the test can send its signals.
 *
 * Usage: `node --import tsx src/__testutils__/interruptedWrite.ts <writer> <handler> <target>`
 * - writer: `text` ({@link AtomicFileWriter.writeAsync}), `buffer`
 *   ({@link AtomicFileWriter.writeBufferAsync}) or `safe` ({@link writeFileSafely})
 * - handler: `report` ({@link reportInterrupts}: the first signal exits) or
 *   `abort` ({@link abortOnInterrupt}: the first signal aborts, the second exits)
 *
 * Lines written: `waiting` once the rename is held, `aborted` after a first
 * signal that did not exit.
 */

import * as fs from 'fs';

import { abortOnInterrupt, reportInterrupts } from '@/commands/shared/interrupt.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { writeFileSafely } from '@/utils/safeFile.js';

const [writer, handler, target] = process.argv.slice(2);
if (writer === undefined || handler === undefined || target === undefined) {
  throw new Error('usage: interruptedWrite.ts <text|buffer|safe> <report|abort> <target>');
}

if (handler === 'abort') {
  abortOnInterrupt().addEventListener('abort', () => process.stdout.write('aborted\n'));
} else {
  reportInterrupts(() => undefined);
}

fs.promises.rename = (): Promise<void> => {
  process.stdout.write('waiting\n');
  return new Promise<void>(() => undefined);
};

const data = 'new content';
const write =
  writer === 'safe'
    ? writeFileSafely(target, data, 0o600)
    : writer === 'buffer'
      ? AtomicFileWriter.writeBufferAsync(target, Buffer.from(data))
      : AtomicFileWriter.writeAsync(target, data);
setInterval(() => undefined, 60_000);
void write;
