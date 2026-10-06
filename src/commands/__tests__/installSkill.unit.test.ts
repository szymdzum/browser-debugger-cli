/**
 * Unit tests for `bdg install-skill`: copying the packaged skill into the
 * agents' skill directories under a home directory.
 */

import * as assert from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { installSkill } from '@/commands/installSkill.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

describe('installSkill', () => {
  let root: string;
  let home: string;
  let source: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bdg-skill-'));
    home = join(root, 'home');
    source = join(root, 'SKILL.md');
    writeFileSync(source, '---\nname: bdg\n---\nv2\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('installs into each target, creating missing directories', () => {
    const result = installSkill(['claude', 'agents'], home, source);

    assert.deepStrictEqual(result, [
      { target: 'claude', path: join(home, '.claude/skills/bdg/SKILL.md'), status: 'installed' },
      { target: 'agents', path: join(home, '.agents/skills/bdg/SKILL.md'), status: 'installed' },
    ]);
    assert.strictEqual(
      readFileSync(join(home, '.agents/skills/bdg/SKILL.md'), 'utf-8'),
      '---\nname: bdg\n---\nv2\n'
    );
  });

  test('overwrites an older copy and leaves an identical one alone', () => {
    const claudePath = join(home, '.claude/skills/bdg/SKILL.md');
    mkdirSync(join(home, '.claude/skills/bdg'), { recursive: true });
    writeFileSync(claudePath, 'v1\n');
    installSkill(['agents'], home, source);

    const result = installSkill(['claude', 'agents'], home, source);

    assert.deepStrictEqual(
      result.map((skill) => skill.status),
      ['updated', 'unchanged']
    );
    assert.strictEqual(readFileSync(claudePath, 'utf-8'), '---\nname: bdg\n---\nv2\n');
  });

  test('a missing source is a not-found error (83)', () => {
    assert.throws(
      () => installSkill(['claude'], home, join(root, 'missing.md')),
      (error: unknown) =>
        error instanceof CommandError && error.exitCode === EXIT_CODES.RESOURCE_NOT_FOUND
    );
  });

  test(
    'an unwritable skill directory is a permission error (82)',
    { skip: process.getuid?.() === 0 },
    () => {
      mkdirSync(home, { recursive: true });
      chmodSync(home, 0o500);
      try {
        assert.throws(
          () => installSkill(['claude'], home, source),
          (error: unknown) =>
            error instanceof CommandError && error.exitCode === EXIT_CODES.PERMISSION_DENIED
        );
      } finally {
        chmodSync(home, 0o700);
      }
    }
  );
});
