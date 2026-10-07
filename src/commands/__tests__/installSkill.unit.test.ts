/**
 * Unit tests for `bdg install-skill`: copying the packaged skill into the
 * agents' skill directories under a home directory.
 */

import * as assert from 'node:assert';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { installSkill } from '@/commands/installSkill.js';
import { CommandError } from '@/errors/index.js';
import { formatInstalledSkills } from '@/ui/formatters/installSkill.js';
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
    const { skills: result } = installSkill(['claude', 'agents'], home, source);

    assert.deepStrictEqual(result, [
      { target: 'claude', path: join(home, '.claude/skills/bdg/SKILL.md'), status: 'installed' },
      { target: 'agents', path: join(home, '.agents/skills/bdg/SKILL.md'), status: 'installed' },
    ]);
    assert.strictEqual(
      readFileSync(join(home, '.agents/skills/bdg/SKILL.md'), 'utf-8'),
      '---\nname: bdg\n---\nv2\n'
    );
  });

  test('replaces a different copy, keeping it as SKILL.md.bak, and leaves an identical one alone', () => {
    const claudePath = join(home, '.claude/skills/bdg/SKILL.md');
    mkdirSync(join(home, '.claude/skills/bdg'), { recursive: true });
    writeFileSync(claudePath, 'v1 with my edits\n');
    installSkill(['agents'], home, source);

    const { skills: result } = installSkill(['claude', 'agents'], home, source);

    assert.deepStrictEqual(result, [
      { target: 'claude', path: claudePath, status: 'updated', backup: `${claudePath}.bak` },
      { target: 'agents', path: join(home, '.agents/skills/bdg/SKILL.md'), status: 'unchanged' },
    ]);
    assert.strictEqual(readFileSync(claudePath, 'utf-8'), '---\nname: bdg\n---\nv2\n');
    assert.strictEqual(readFileSync(`${claudePath}.bak`, 'utf-8'), 'v1 with my edits\n');
  });

  test('names the backup under the path it belongs to', () => {
    const text = formatInstalledSkills({
      skills: [
        { target: 'claude', path: '/h/SKILL.md', status: 'updated', backup: '/h/SKILL.md.bak' },
      ],
    });

    assert.match(
      text,
      /^ {2}claude {2}updated {4}\/h\/SKILL\.md\n {21}previous copy kept in \/h\/SKILL\.md\.bak$/m
    );
  });

  test('a missing source is a not-found error (83)', () => {
    assert.throws(
      () => installSkill(['claude'], home, join(root, 'missing.md')),
      (error: unknown) =>
        error instanceof CommandError && error.exitCode === EXIT_CODES.RESOURCE_NOT_FOUND
    );
  });

  test(
    'an unwritable skill directory is a permission error (82) that leaves the backup alone',
    { skip: process.getuid?.() === 0 },
    () => {
      const dir = join(home, '.claude/skills/bdg');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'my edit\n');
      writeFileSync(join(dir, 'SKILL.md.bak'), 'older edit\n');
      chmodSync(dir, 0o500);
      try {
        const { skills, failure } = installSkill(['claude'], home, source);
        assert.deepStrictEqual(skills, []);
        assert.strictEqual(failure?.exitCode, EXIT_CODES.PERMISSION_DENIED);
        assert.match(
          failure.metadata.suggestion ?? '',
          /^Check the permissions of that directory$/
        );
        assert.strictEqual(readFileSync(join(dir, 'SKILL.md.bak'), 'utf-8'), 'older edit\n');
      } finally {
        chmodSync(dir, 0o700);
      }
    }
  );

  test('a failed target still reports the one written, and its backup', () => {
    const claudePath = join(home, '.claude/skills/bdg/SKILL.md');
    mkdirSync(dirname(claudePath), { recursive: true });
    writeFileSync(claudePath, 'my edit\n');
    writeFileSync(join(home, '.agents'), 'a file in the way');

    const { skills, failure } = installSkill(['claude', 'agents'], home, source);

    assert.deepStrictEqual(skills, [
      { target: 'claude', path: claudePath, status: 'updated', backup: `${claudePath}.bak` },
    ]);
    assert.match(failure?.message ?? '', /Could not write .*\.agents.*ENOTDIR|EEXIST/);
    assert.strictEqual(
      failure?.metadata.suggestion,
      'A part of that path is a file, not a directory: move it away, or install for the other agent only (--claude)'
    );
  });

  test('replaces a read-only backup, and gives the new one the default mode', () => {
    const claudePath = join(home, '.claude/skills/bdg/SKILL.md');
    mkdirSync(dirname(claudePath), { recursive: true });
    writeFileSync(claudePath, 'v1\n');
    chmodSync(claudePath, 0o400);
    writeFileSync(`${claudePath}.bak`, 'v0\n');
    chmodSync(`${claudePath}.bak`, 0o400);

    const { skills, failure } = installSkill(['claude'], home, source);

    assert.strictEqual(failure, undefined);
    assert.strictEqual(skills[0]?.status, 'updated');
    assert.strictEqual(readFileSync(`${claudePath}.bak`, 'utf-8'), 'v1\n');
    assert.notStrictEqual(statSync(`${claudePath}.bak`).mode & 0o200, 0);
  });
});
