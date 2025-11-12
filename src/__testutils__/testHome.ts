/**
 * Ensure smoke/integration tests use a writable BDG session directory and HOME.
 *
 * Some CI/macOS environments block writing to ~/.bdg and ~/Library directly.
 * We point bdg to a repo-local session directory via BDG_SESSION_DIR and also
 * override HOME so Chrome's Crashpad can write to ~/Library/Application Support/...
 * without hitting sandbox restrictions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

let cachedSessionDir: string | null = null;
let cachedHomeDir: string | null = null;

/**
 * Set BDG_SESSION_DIR to a deterministic path under the repo and make sure it
 * exists on disk. Subsequent calls are cheap and return the same path.
 *
 * @returns Absolute path used as BDG session directory for tests
 */
export function ensureTestSessionDir(): string {
  if (cachedSessionDir) {
    return cachedSessionDir;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '..', '..');
  const fallbackDir = path.join(repoRoot, '.tmp', 'bdg-smoke-session');

  const desiredDir = process.env['BDG_TEST_SESSION_DIR'] ?? fallbackDir;
  fs.mkdirSync(desiredDir, { recursive: true });

  process.env['BDG_SESSION_DIR'] = desiredDir;

  cachedSessionDir = desiredDir;
  return cachedSessionDir;
}

/**
 * Get a writable HOME directory for tests that shields Chrome from sandbox restrictions.
 *
 * macOS workspace sandboxes block writes to ~/Library, causing Chrome's Crashpad to fail
 * with EPERM errors. By overriding HOME to a repo-local directory, Chrome can safely
 * write its crash handler settings without hitting the sandbox wall.
 *
 * @returns Absolute path to use as HOME for test processes
 */
export function getTestHomeDir(): string {
  if (cachedHomeDir) {
    return cachedHomeDir;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '..', '..');
  const fallbackDir = path.join(repoRoot, '.tmp', 'bdg-smoke-home');

  const desiredDir = process.env['BDG_TEST_HOME_DIR'] ?? fallbackDir;
  fs.mkdirSync(desiredDir, { recursive: true });

  // Create Library/Application Support structure for Chrome's Crashpad
  const libraryDir = path.join(desiredDir, 'Library', 'Application Support', 'Google', 'Chrome');
  fs.mkdirSync(libraryDir, { recursive: true });

  cachedHomeDir = desiredDir;
  return cachedHomeDir;
}
