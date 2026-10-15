import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { findStaleSource } from '@/__testutils__/distFreshness.js';

/**
 * Create `src/` and `dist/index.js` in a temp directory, `dist` built at `builtAt`.
 */
function makeProject(builtAt: Date): { src: string; entry: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-fresh-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'sub', '__tests__'), { recursive: true });
  const entry = path.join(root, 'dist', 'index.js');
  fs.mkdirSync(path.dirname(entry));
  fs.writeFileSync(entry, '');
  fs.utimesSync(entry, builtAt, builtAt);
  return { src, entry };
}

/** Write a file in `src` with the given modification time. */
function touch(file: string, at: Date): string {
  fs.writeFileSync(file, '');
  fs.utimesSync(file, at, at);
  return file;
}

void describe('findStaleSource', () => {
  const built = new Date('2026-01-02T00:00:00Z');
  const older = new Date('2026-01-01T00:00:00Z');
  const newer = new Date('2026-01-03T00:00:00Z');

  void it('is undefined when dist is newer than every source file', () => {
    const { src, entry } = makeProject(built);
    touch(path.join(src, 'sub', 'a.ts'), older);
    assert.equal(findStaleSource(src, entry), undefined);
  });

  void it('names a source file newer than dist, in a subdirectory too', () => {
    const { src, entry } = makeProject(built);
    const stale = touch(path.join(src, 'sub', 'a.ts'), newer);
    assert.equal(findStaleSource(src, entry), stale);
  });

  void it('ignores edited test code', () => {
    const { src, entry } = makeProject(built);
    touch(path.join(src, 'sub', '__tests__', 'a.test.ts'), newer);
    touch(path.join(src, 'b.test.ts'), newer);
    assert.equal(findStaleSource(src, entry), undefined);
  });
});
