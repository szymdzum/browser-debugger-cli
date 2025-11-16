/**
 * Chrome command-line flags builder.
 *
 * Constructs the Chrome flags array from launch options, handling:
 * - Base chrome-launcher defaults
 * - bdg-specific flags (remote debugging, etc.)
 * - Docker environment detection and GPU-disabling flags
 * - Headless mode
 */

import * as fs from 'fs';

import * as chromeLauncher from 'chrome-launcher';

import {
  BDG_CHROME_FLAGS,
  DEFAULT_CDP_PORT,
  HEADLESS_FLAG,
  DOCKER_CHROME_FLAGS,
} from '@/constants.js';

/**
 * Options that affect Chrome flags construction.
 */
export interface FlagsBuilderOptions {
  /** CDP port number for remote debugging */
  port?: number | undefined;
  /** Whether to ignore chrome-launcher default flags */
  ignoreDefaultFlags?: boolean | undefined;
  /** Whether to launch in headless mode */
  headless?: boolean | undefined;
  /** Additional Chrome command-line flags */
  chromeFlags?: string[] | undefined;
}

const REMOTE_DEBUGGING_FLAG = (port: number): string => `--remote-debugging-port=${port}`;

/**
 * Check if running inside a Docker container.
 *
 * Detects Docker environment by checking for:
 * 1. /.dockerenv file (standard Docker indicator)
 * 2. "docker" or "containerd" in /proc/self/cgroup
 *
 * @returns True if running in Docker, false otherwise
 */
export function isDocker(): boolean {
  try {
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }

    if (fs.existsSync('/proc/self/cgroup')) {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      return cgroup.includes('docker') || cgroup.includes('containerd');
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Build Chrome flags array from launch options.
 *
 * Uses chrome-launcher default flags as base (unless ignoreDefaultFlags is true)
 * and layers bdg-specific overrides on top. Headless mode uses the new headless
 * implementation for better compatibility.
 *
 * When running in Docker, automatically adds GPU-disabling flags to work around
 * graphics limitations in containerized environments.
 *
 * @param options - Launch options containing flag preferences
 * @returns Array of Chrome command-line flags
 *
 * @example
 * ```typescript
 * // Standard flags
 * const flags = buildChromeFlags({ port: 9222 });
 *
 * // Headless with custom flags
 * const flags = buildChromeFlags({
 *   port: 9222,
 *   headless: true,
 *   chromeFlags: ['--window-size=1920,1080']
 * });
 *
 * // Docker environment (auto-detects)
 * const flags = buildChromeFlags({ port: 9222 });
 * // Includes --disable-gpu, --no-sandbox if in Docker
 * ```
 */
export function buildChromeFlags(options: FlagsBuilderOptions): string[] {
  const port = options.port ?? DEFAULT_CDP_PORT;

  const baseFlags = options.ignoreDefaultFlags ? [] : chromeLauncher.Launcher.defaultFlags();

  const bdgFlags: string[] = [REMOTE_DEBUGGING_FLAG(port), ...BDG_CHROME_FLAGS];

  const dockerFlags = isDocker() ? DOCKER_CHROME_FLAGS : [];

  if (options.headless) {
    return [
      HEADLESS_FLAG,
      ...baseFlags,
      ...bdgFlags,
      ...dockerFlags,
      ...(options.chromeFlags ?? []),
    ];
  }

  return [...baseFlags, ...bdgFlags, ...dockerFlags, ...(options.chromeFlags ?? [])];
}
