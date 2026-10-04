import { readFileSync } from 'fs';
import { join } from 'path';

import { PACKAGE_ROOT } from '@/utils/packageRoot.js';

/**
 * Get the package version.
 * Reads package.json once and caches the result.
 */
let cachedVersion: string = '';

export function getVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const pkgPath = join(PACKAGE_ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }

  return cachedVersion;
}

export const VERSION: string = getVersion();
