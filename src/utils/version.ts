import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    // Fallback if package.json cannot be read
    cachedVersion = '0.0.0';
  }

  return cachedVersion;
}

export const VERSION: string = getVersion();
