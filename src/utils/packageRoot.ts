/**
 * Package root resolution.
 *
 * Paths to package files (package.json, dist/daemon.js) are resolved from the
 * package root rather than relative to the calling module, so they stay
 * correct whether the code runs from tsc output, the bundled CLI, or source.
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Walk up from a directory to the nearest one containing package.json.
 *
 * @param startDir - Directory to start searching from
 * @returns Absolute path of the package root
 * @throws Error when no package.json exists in any ancestor
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`package.json not found above ${startDir}`);
    }
    dir = parent;
  }
  return dir;
}

/** Absolute path of the bdg package root. */
export const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Absolute path of the daemon entry script. */
export const DAEMON_SCRIPT_PATH = join(PACKAGE_ROOT, 'dist', 'daemon.js');
