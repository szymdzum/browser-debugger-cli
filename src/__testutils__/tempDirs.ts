/**
 * Temporary directories for tests that are removed afterwards, also when a
 * test fails: create them with {@link makeTempDir} and call
 * {@link removeTempDirs} from a file-level `after` hook.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Directories created by {@link makeTempDir} and not yet removed */
const created = new Set<string>();

/**
 * Create a temporary directory that {@link removeTempDirs} removes.
 *
 * @param prefix - Name prefix, e.g. `bdg-har-`
 * @returns Path of the new directory (in the OS temp dir)
 */
export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.add(dir);
  return dir;
}

/**
 * Remove every directory created by {@link makeTempDir}.
 */
export function removeTempDirs(): void {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created.clear();
}
