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

import { BDG_CHROME_FLAGS, HEADLESS_FLAG, DOCKER_CHROME_FLAGS } from '@/constants.js';

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
  /** bdg session directory; adds a marker flag used to verify the process during crash cleanup */
  sessionDir?: string | undefined;
}

/**
 * Marker flag identifying a Chrome launched by bdg for a given session directory.
 *
 * Chrome ignores unknown switches; crash cleanup matches this exact string in a
 * process's command line before killing it, so a reused PID (or the user's own
 * debugging Chrome) is never mistaken for a bdg Chrome.
 *
 * @param sessionDir - bdg session directory
 * @returns Marker flag
 */
export function chromeSessionMarkerFlag(sessionDir: string): string {
  return `--bdg-session-dir=${sessionDir}`;
}

/** Environment variable that forces `--no-sandbox` (e.g. in restricted containers). */
const NO_SANDBOX_ENV = 'BDG_NO_SANDBOX';

/**
 * Whether Chrome must run with `--no-sandbox`.
 *
 * Only where the sandbox cannot work, so it stays on everywhere else
 * (including Podman-based dev containers such as toolbox/distrobox):
 * - Docker: the default seccomp profile blocks the user namespaces the
 *   sandbox needs, for root and non-root users alike
 * - root on Linux: Chrome refuses to start sandboxed as root
 * - `BDG_NO_SANDBOX=1`: explicit opt-in for other restricted environments
 *
 * @returns True if `--no-sandbox` should be added
 */
export function needsNoSandbox(): boolean {
  if (process.env[NO_SANDBOX_ENV] === '1') return true;
  if (process.platform === 'linux' && process.getuid?.() === 0) return true;
  return fs.existsSync('/.dockerenv');
}

/**
 * Check if running inside a Docker container.
 *
 * Detects a container by checking for:
 * 1. /.dockerenv (Docker) or /run/.containerenv (Podman)
 * 2. "docker" or "containerd" in /proc/self/cgroup (cgroup v1 hosts)
 *
 * @returns True if running in Docker, false otherwise
 */
export function isDocker(): boolean {
  try {
    if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) {
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
 * Custom flags are passed via the chromeFlags option. The BDG_CHROME_FLAGS env var
 * is parsed by the CLI and merged into chromeFlags before reaching this function.
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
/**
 * chrome-launcher's default flags (plus its Linux sandbox flag). bdg passes
 * them itself and tells chrome-launcher to skip its own copy, so each flag
 * appears once; chrome-launcher adds `--remote-debugging-port`.
 *
 * @returns Default flags
 */
function defaultFlags(): string[] {
  const flags = chromeLauncher.Launcher.defaultFlags();
  return process.platform === 'linux' ? [...flags, '--disable-setuid-sandbox'] : flags;
}

export function buildChromeFlags(options: FlagsBuilderOptions): string[] {
  const baseFlags = options.ignoreDefaultFlags ? [] : defaultFlags();

  const bdgFlags: string[] = [
    ...(options.sessionDir ? [chromeSessionMarkerFlag(options.sessionDir)] : []),
    ...BDG_CHROME_FLAGS,
  ];

  const dockerFlags = isDocker() ? DOCKER_CHROME_FLAGS : [];
  const sandboxFlags = needsNoSandbox() ? ['--no-sandbox'] : [];

  // Custom flags from CLI option (env var BDG_CHROME_FLAGS is parsed by CLI and passed here)
  const customFlags = options.chromeFlags ?? [];

  if (options.headless) {
    return [
      HEADLESS_FLAG,
      ...baseFlags,
      ...bdgFlags,
      ...dockerFlags,
      ...sandboxFlags,
      ...customFlags,
    ];
  }

  return [...baseFlags, ...bdgFlags, ...dockerFlags, ...sandboxFlags, ...customFlags];
}
