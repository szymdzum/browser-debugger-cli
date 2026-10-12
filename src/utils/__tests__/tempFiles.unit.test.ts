/**
 * Temp files of writes in progress are tracked for the exit path (#678): a
 * temp file is tracked in the same tick it is created (no exit can come
 * between), the atomic writer creates it as soon as the write is called,
 * every write that ends (done, failed write, failed rename, failed create)
 * stops tracking it, and the `exit` listener is installed once, however many
 * writes there are.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, afterEach, describe, it, mock } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { TEMP_FILE_FLAGS, writeFileSafely } from '@/utils/safeFile.js';
import { createTrackedTempFile, pendingTempFileCount } from '@/utils/tempFiles.js';

/** The writers, each writing `data` to `file` */
const WRITERS: Array<[string, (file: string, data: string) => Promise<void>]> = [
  ['writeAsync', (file, data) => AtomicFileWriter.writeAsync(file, data)],
  ['writeBufferAsync', (file, data) => AtomicFileWriter.writeBufferAsync(file, data as never)],
  ['writeFileSafely', (file, data) => writeFileSafely(file, data, 0o600)],
];

/** Data no writer can write */
const UNWRITABLE = {} as unknown as string;

void describe('temp files of writes in progress (#678)', () => {
  after(removeTempDirs);
  afterEach(() => mock.restoreAll());

  for (const [name, write] of WRITERS) {
    void it(`${name}: a failed write stops tracking its temp file and removes it`, async () => {
      const dir = makeTempDir('bdg-temp-files-');
      await assert.rejects(write(path.join(dir, 'out.json'), UNWRITABLE));
      assert.equal(pendingTempFileCount(), 0);
      assert.deepEqual(fs.readdirSync(dir), []);
    });

    void it(`${name}: a failed rename stops tracking its temp file and removes it`, async () => {
      const dir = makeTempDir('bdg-temp-files-');
      mock.method(fs.promises, 'rename', () => Promise.reject(new Error('rename failed')));
      const data = name === 'writeBufferAsync' ? (Buffer.from('x') as never) : 'x';
      await assert.rejects(write(path.join(dir, 'out.json'), data), /rename failed/);
      assert.equal(pendingTempFileCount(), 0);
      assert.deepEqual(fs.readdirSync(dir), []);
    });

    void it(`${name}: a failed create tracks nothing`, async () => {
      const dir = makeTempDir('bdg-temp-files-');
      await assert.rejects(write(path.join(dir, 'missing', 'out.json'), 'x'), { code: 'ENOENT' });
      assert.equal(pendingTempFileCount(), 0);
    });
  }

  void it('creates the temp file synchronously and tracks it at once, until untracked', () => {
    const dir = makeTempDir('bdg-temp-files-');
    const { fd, untrack } = createTrackedTempFile(path.join(dir, 'out.tmp'), TEMP_FILE_FLAGS);
    fs.closeSync(fd);
    assert.deepEqual(fs.readdirSync(dir), ['out.tmp']);
    assert.equal(pendingTempFileCount(), 1);
    untrack();
    assert.equal(pendingTempFileCount(), 0);
  });

  for (const [name, write] of WRITERS.slice(0, 2)) {
    void it(`${name}: the temp file exists and is tracked as soon as the write is called`, async () => {
      const dir = makeTempDir('bdg-temp-files-');
      const data = name === 'writeBufferAsync' ? (Buffer.from('x') as never) : 'x';
      const writing = write(path.join(dir, 'out.json'), data);
      assert.equal(fs.readdirSync(dir).length, 1);
      assert.equal(pendingTempFileCount(), 1);
      await writing;
      assert.equal(pendingTempFileCount(), 0);
    });
  }

  void it('installs one exit listener, however many writes', async () => {
    const dir = makeTempDir('bdg-temp-files-');
    await AtomicFileWriter.writeAsync(path.join(dir, 'first.json'), 'x');
    const listeners = process.listenerCount('exit');
    for (let n = 0; n < 5; n += 1) {
      await AtomicFileWriter.writeAsync(path.join(dir, `a${n}.json`), 'x');
      await writeFileSafely(path.join(dir, `s${n}.json`), 'x', 0o600);
    }
    assert.equal(process.listenerCount('exit'), listeners);
  });
});
