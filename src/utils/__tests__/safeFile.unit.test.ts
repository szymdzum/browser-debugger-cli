/**
 * Targets of safe writes (#895): a missing path or a regular file is replaced
 * through a temp file, a symlink to a regular file is written through (the
 * link stays), and a FIFO, device, directory or a symlink to one of these or
 * to a missing path is refused without touching it or leaving a temp file.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { resolveWriteTarget, writeFileSafely } from '@/utils/safeFile.js';

after(removeTempDirs);

/**
 * Assert that a write is refused with a code and leaves the directory as it was.
 *
 * @param dir - Directory of the target
 * @param file - Target
 * @param code - Expected error code
 */
async function assertRefused(dir: string, file: string, code: string): Promise<void> {
  const before = fs.readdirSync(dir).sort();
  await assert.rejects(resolveWriteTarget(file), { code });
  await assert.rejects(writeFileSafely(file, 'new', 0o600), { code });
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'nothing created or removed');
}

void describe('safe file targets (#895)', { skip: process.platform === 'win32' }, () => {
  it('writes a missing path', async () => {
    const file = path.join(makeTempDir('bdg-safe-'), 'out.json');
    assert.equal(await resolveWriteTarget(file), file);
    await writeFileSafely(file, 'new', 0o600);
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it('replaces a regular file', async () => {
    const dir = makeTempDir('bdg-safe-');
    const file = path.join(dir, 'out.json');
    fs.writeFileSync(file, 'old');
    assert.equal(await resolveWriteTarget(file), file);
    await writeFileSafely(file, 'new', 0o600);
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(dir), ['out.json'], 'no temp file left');
  });

  it('writes through a symlink to a regular file, keeping the link', async () => {
    const dir = makeTempDir('bdg-safe-');
    const real = path.join(dir, 'real.json');
    fs.writeFileSync(real, 'ORIGINAL');
    fs.chmodSync(real, 0o644);
    const link = path.join(dir, 'link.json');
    fs.symlinkSync(real, link);
    assert.equal(await resolveWriteTarget(link), fs.realpathSync(real));
    await writeFileSafely(link, 'new', 0o600);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.readlinkSync(link), real);
    assert.equal(fs.readFileSync(real, 'utf8'), 'new');
    assert.equal(fs.statSync(real).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['link.json', 'real.json'], 'no temp file left');
  });

  it('refuses a FIFO and leaves it in place', async () => {
    const dir = makeTempDir('bdg-safe-');
    const fifo = path.join(dir, 'out.json');
    execFileSync('mkfifo', [fifo]);
    await assertRefused(dir, fifo, 'ENOTREGULAR');
    assert.ok(fs.lstatSync(fifo).isFIFO());
  });

  it('refuses a symlink to a FIFO and keeps both', async () => {
    const dir = makeTempDir('bdg-safe-');
    const fifo = path.join(dir, 'fifo');
    execFileSync('mkfifo', [fifo]);
    const link = path.join(dir, 'out.json');
    fs.symlinkSync(fifo, link);
    await assertRefused(dir, link, 'ENOTREGULAR');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.ok(fs.lstatSync(fifo).isFIFO());
  });

  it('refuses a device (/dev/null) before creating anything next to it', async () => {
    await assert.rejects(resolveWriteTarget('/dev/null'), { code: 'ENOTREGULAR' });
    await assert.rejects(writeFileSafely('/dev/null', 'new', 0o600), { code: 'ENOTREGULAR' });
    assert.ok(fs.lstatSync('/dev/null').isCharacterDevice());
  });

  it('refuses a symlink to a device and keeps it', async () => {
    const dir = makeTempDir('bdg-safe-');
    const link = path.join(dir, 'out.json');
    fs.symlinkSync('/dev/null', link);
    await assertRefused(dir, link, 'ENOTREGULAR');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
  });

  it('refuses a dangling symlink and keeps it', async () => {
    const dir = makeTempDir('bdg-safe-');
    const link = path.join(dir, 'out.json');
    fs.symlinkSync(path.join(dir, 'missing.json'), link);
    await assertRefused(dir, link, 'EDANGLING');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
  });

  it('refuses a directory and a symlink to one', async () => {
    const dir = makeTempDir('bdg-safe-');
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    const link = path.join(dir, 'link');
    fs.symlinkSync(sub, link);
    await assertRefused(dir, sub, 'EISDIR');
    await assertRefused(dir, link, 'EISDIR');
    assert.deepEqual(fs.readdirSync(sub), []);
  });
});
