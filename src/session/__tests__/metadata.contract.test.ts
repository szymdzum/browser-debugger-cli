/**
 * Metadata contract tests - Test behavior, not implementation
 *
 * Focus: Corruption handling, self-healing, error recovery
 */

import * as fs from 'fs';
import assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { writeSessionMetadata, readSessionMetadata } from '@/session/metadata.js';
import type { TelemetryType } from '@/types.js';


describe('Metadata Contract', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-metadata-test-'));
    process.env['BDG_SESSION_DIR'] = testDir;
  });

  afterEach(() => {
    delete process.env['BDG_SESSION_DIR'];
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('writes and reads metadata', () => {
    const metadata = {
      bdgPid: process.pid,
      chromePid: 12345,
      startTime: Date.now(),
      port: 9222,
      targetId: 'target-123',
      webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/123',
      activeTelemetry: ['network', 'console'] as TelemetryType[],
    };

    writeSessionMetadata(metadata);
    const read = readSessionMetadata();

    assert.deepStrictEqual(read, metadata, 'Should read what was written');
  });

  it('returns null for non-existent metadata', () => {
    const metadata = readSessionMetadata();
    assert.strictEqual(metadata, null, 'Should return null when file does not exist');
  });

  it('handles corrupt JSON', () => {
    const metaPath = path.join(testDir, 'session.meta.json');
    fs.writeFileSync(metaPath, 'not valid json{]');

    const metadata = readSessionMetadata();
    assert.strictEqual(metadata, null, 'Should return null for corrupt JSON');
  });

  it('self-heals corrupt metadata when requested', () => {
    const metaPath = path.join(testDir, 'session.meta.json');
    fs.writeFileSync(metaPath, 'not valid json{]');

    readSessionMetadata({ selfHealOnCorruption: true });

    assert.strictEqual(fs.existsSync(metaPath), false, 'Should remove corrupt file');
  });

  it('preserves corrupt file when self-heal disabled', () => {
    const metaPath = path.join(testDir, 'session.meta.json');
    fs.writeFileSync(metaPath, 'not valid json{]');

    readSessionMetadata({ selfHealOnCorruption: false });

    assert.strictEqual(fs.existsSync(metaPath), true, 'Should not remove file without self-heal');
  });

  it('handles empty file', () => {
    const metaPath = path.join(testDir, 'session.meta.json');
    fs.writeFileSync(metaPath, '');

    const metadata = readSessionMetadata();
    assert.strictEqual(metadata, null, 'Should handle empty file');
  });

  it('supports minimal metadata', () => {
    const minimal = {
      bdgPid: process.pid,
      startTime: Date.now(),
      port: 9222,
    };

    writeSessionMetadata(minimal);
    const read = readSessionMetadata();

    assert.deepStrictEqual(read, minimal, 'Should support minimal metadata');
  });

  it('handles optional fields', () => {
    const withOptional = {
      bdgPid: process.pid,
      startTime: Date.now(),
      port: 9222,
    };

    writeSessionMetadata(withOptional);
    const read = readSessionMetadata();

    assert.deepStrictEqual(read, withOptional, 'Should handle missing optional fields');
  });
});
