/**
 * Ensure smoke/integration tests use a writable BDG session directory and HOME.
 *
 * Some CI/macOS environments block writing to ~/.bdg and ~/Library directly.
 * We point bdg to a session directory of this test process via BDG_SESSION_DIR
 * and also override HOME so Chrome's Crashpad can write to
 * ~/Library/Application Support/... without hitting sandbox restrictions.
 *
 * The session directory is unique per process (removed when it exits): two
 * test runs at the same time (two agents, a checkout and a worktree) would
 * otherwise stop and clean up each other's sessions. `BDG_TEST_SESSION_PARENT`
 * moves these directories under another parent (one per worktree, keep it
 * short for the socket path); `BDG_TEST_SESSION_DIR` replaces them with one
 * fixed directory.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

let cachedSessionDir: string | null = null;
let cachedHomeDir: string | null = null;

/** Default parent of the per-process session directories: short, for the daemon's socket path */
const SESSION_DIR_PARENT = os.platform() === 'win32' ? os.tmpdir() : '/tmp';

/**
 * Parent of the per-process session directories: `BDG_TEST_SESSION_PARENT`
 * when set (created if missing), else {@link SESSION_DIR_PARENT}.
 *
 * @returns Absolute path of an existing directory
 */
function sessionDirParent(): string {
  const parent = process.env['BDG_TEST_SESSION_PARENT'];
  if (!parent) return SESSION_DIR_PARENT;
  const absolute = path.resolve(parent);
  fs.mkdirSync(absolute, { recursive: true });
  return absolute;
}

/**
 * Whether session directories are kept when the test process exits
 * (`BDG_TEST_KEEP_DIRS=1`), so CI can upload their logs after a failure.
 *
 * @returns True when the directories should be kept
 */
function keepSessionDirs(): boolean {
  return process.env['BDG_TEST_KEEP_DIRS'] === '1';
}

/**
 * A session directory for this process under {@link sessionDirParent},
 * removed when it exits (after
 * ending a session a test left running in it, which would otherwise be
 * orphaned without its files). With `BDG_TEST_KEEP_DIRS=1` the session is
 * still ended but the directory and its logs stay.
 *
 * @returns Absolute path
 */
function ownSessionDir(): string {
  const dir = fs.mkdtempSync(path.join(sessionDirParent(), 'bdg-test-'));
  process.on('exit', () => {
    try {
      endLeftoverSession(dir);
    } finally {
      if (!keepSessionDirs()) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  return dir;
}

/**
 * End a session left in a directory with `bdg cleanup --force`, which checks
 * each process's command line before signalling it (a pid file may name a
 * reused pid). Only runs when the directory still has a pid file.
 *
 * @param dir - Session directory
 */
function endLeftoverSession(dir: string): void {
  const left = ['daemon.pid', 'chrome.pid'].some((file) => fs.existsSync(path.join(dir, file)));
  if (!left) return;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  spawnSync(process.execPath, [path.join(repoRoot, 'dist', 'index.js'), 'cleanup', '--force'], {
    env: { ...process.env, BDG_SESSION_DIR: dir },
    stdio: 'ignore',
    timeout: 15000,
  });
}

/**
 * Set BDG_SESSION_DIR to a directory of this test process and make sure it
 * exists on disk. Subsequent calls are cheap and return the same path.
 *
 * `BDG_TEST_SESSION_DIR` overrides it with a fixed directory, which disables
 * per-process isolation: every test process of the run shares that directory
 * (its sessions and metadata), and it is not removed on exit. To keep a run's
 * directories apart from other runs, set `BDG_TEST_SESSION_PARENT` instead.
 *
 * @returns Absolute path used as BDG session directory for tests
 */
export function ensureTestSessionDir(): string {
  if (cachedSessionDir) {
    return cachedSessionDir;
  }

  const desiredDir = process.env['BDG_TEST_SESSION_DIR'] ?? ownSessionDir();
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
