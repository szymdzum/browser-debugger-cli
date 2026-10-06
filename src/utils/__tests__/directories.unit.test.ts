/**
 * Whether a directory bdg is about to create and write can be used.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { directoryProblem, makeDirectory } from '@/utils/directories.js';

void describe('directoryProblem', () => {
  void it('accepts a new directory under a writable one', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-dirs-'));
    try {
      assert.equal(directoryProblem(path.join(base, 'a', 'b')), null);
      assert.equal(directoryProblem(base), null);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  void it('refuses pseudo-filesystems, files and paths through a file', () => {
    assert.deepEqual(directoryProblem('/proc/x/y'), {
      reason: '/proc is a pseudo-filesystem',
      denied: false,
    });
    assert.equal(directoryProblem('/sys')?.reason, '/sys is a pseudo-filesystem');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-dirs-'));
    try {
      const file = path.join(base, 'file');
      fs.writeFileSync(file, '');
      assert.equal(directoryProblem(file)?.reason, 'it is a file');
      assert.equal(directoryProblem(path.join(file, 'x'))?.reason, `${file} is a file`);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  void it(
    'reports a directory it cannot write as denied',
    { skip: process.getuid?.() === 0 },
    () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-dirs-'));
      try {
        fs.chmodSync(base, 0o500);
        const problem = directoryProblem(path.join(base, 'profile'));
        assert.equal(problem?.denied, true);
        assert.match(problem?.reason ?? '', /is not writable \(EACCES\)/);
      } finally {
        fs.chmodSync(base, 0o700);
        fs.rmSync(base, { recursive: true, force: true });
      }
    }
  );

  void it('creates a directory, or fails at once with a code callers map', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-dirs-'));
    try {
      makeDirectory(path.join(base, 'a', 'b'));
      assert.ok(fs.statSync(path.join(base, 'a', 'b')).isDirectory());
      assert.throws(() => makeDirectory('/proc/bdg-x'), { code: 'EPSEUDOFS' });
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
