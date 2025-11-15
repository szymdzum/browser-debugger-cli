import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AtomicFileWriter } from '@/utils/atomicFile.js';

void describe('AtomicFileWriter contract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-writer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  void it('writes synchronously without leaving temporary artifacts', () => {
    const filePath = path.join(tmpDir, 'sync.json');

    AtomicFileWriter.writeSync(filePath, 'sync payload');

    const finalContent = fs.readFileSync(filePath, 'utf-8');
    assert.equal(finalContent, 'sync payload');

    const tempArtifacts = fs.readdirSync(tmpDir).filter((file) => file.startsWith('sync.json.'));
    assert.equal(
      tempArtifacts.length,
      0,
      `Expected no leftover temp files, found: ${tempArtifacts.join(', ')}`
    );
  });

  void it('supports concurrent async writes to the same target file', async () => {
    const filePath = path.join(tmpDir, 'async.json');
    const payloads = ['first payload', 'second payload', 'third payload'];

    await Promise.all(payloads.map((payload) => AtomicFileWriter.writeAsync(filePath, payload)));

    const finalContent = fs.readFileSync(filePath, 'utf-8');
    assert(
      payloads.includes(finalContent),
      `Final content "${finalContent}" should match one of the concurrent writes`
    );

    const tempArtifacts = fs.readdirSync(tmpDir).filter((file) => file.startsWith('async.json.'));
    assert.equal(
      tempArtifacts.length,
      0,
      `Expected concurrent writes to clean up temp files, found: ${tempArtifacts.join(', ')}`
    );
  });

  void it('cleans up temporary file when rename fails', () => {
    const blockedPath = path.join(tmpDir, 'cannot-overwrite');
    fs.mkdirSync(blockedPath);

    assert.throws(
      () => AtomicFileWriter.writeSync(blockedPath, 'payload'),
      /EISDIR|is a directory/
    );

    const tempArtifacts = fs
      .readdirSync(tmpDir)
      .filter((file) => file.startsWith('cannot-overwrite.'));
    assert.equal(tempArtifacts.length, 0, 'Temporary file should be removed when rename fails');
    assert.equal(
      fs.existsSync(blockedPath),
      true,
      'Original directory should remain intact after failure'
    );
  });
});
