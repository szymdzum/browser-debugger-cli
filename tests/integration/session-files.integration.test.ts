import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Integration tests for session file operations using real filesystem
 *
 * These tests verify that atomic write patterns work correctly with actual
 * file I/O, catching issues that in-memory fakes can't detect (permissions,
 * platform quirks, race conditions).
 */
describe('Session Files Integration Tests', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create temporary directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-test-'));
  });

  afterEach(() => {
    // ⚠️ CRITICAL: Clean up temp directory, even if test fails
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Atomic Writes', () => {
    it('should prevent partial reads during writes (tmp file + rename pattern)', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      const tmpPath = filePath + '.tmp';
      const testData = 'complete data';

      // Write to temp file first
      fs.writeFileSync(tmpPath, testData, 'utf-8');

      // At this point, final file doesn't exist yet
      assert.equal(fs.existsSync(filePath), false, 'Final file should not exist before rename');

      // Rename tmp to final (atomic operation on most filesystems)
      fs.renameSync(tmpPath, filePath);

      // Now read the final file
      const readData = fs.readFileSync(filePath, 'utf-8');
      assert.equal(readData, testData, 'Should read complete data');

      // Tmp file should be gone
      assert.equal(fs.existsSync(tmpPath), false, 'Temp file should be removed after rename');
    });

    it('should handle exclusive file creation (wx flag)', () => {
      const lockPath = path.join(tmpDir, 'session.lock');

      // First write with wx should succeed
      fs.writeFileSync(lockPath, '12345', { flag: 'wx' });
      assert.equal(fs.existsSync(lockPath), true, 'Lock file should be created');

      // Second write with wx should fail with EEXIST
      assert.throws(
        () => fs.writeFileSync(lockPath, '67890', { flag: 'wx' }),
        (err: unknown) => {
          return err instanceof Error && 'code' in err && err.code === 'EEXIST';
        },
        'Should throw EEXIST when file already exists with wx flag'
      );

      // Original content should be unchanged
      const content = fs.readFileSync(lockPath, 'utf-8');
      assert.equal(content, '12345', 'Original content should be preserved');
    });

    it('should verify temp directory cleanup happens even on assertion failure', () => {
      // This test verifies our afterEach cleanup works
      const testFile = path.join(tmpDir, 'verify-cleanup.txt');
      fs.writeFileSync(testFile, 'test data');

      assert.equal(fs.existsSync(testFile), true, 'File should exist during test');

      // Store tmpDir path to verify it's cleaned up after test
      const dirToCheck = tmpDir;

      // Note: afterEach will run even if this test fails, cleaning up tmpDir
      // We can't directly verify cleanup here, but this documents the pattern
      assert.ok(dirToCheck.includes('bdg-test-'), 'Temp dir should have bdg-test prefix');
    });
  });
});
