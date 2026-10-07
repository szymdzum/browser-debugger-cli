/**
 * Whether Chrome can show a window, which decides the default of
 * `--headless`.
 */

/**
 * Whether an environment variable is set and not empty.
 *
 * @param env - Environment variables
 * @param name - Variable name
 * @returns True when set to a non-empty value
 */
function isSet(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  return value !== undefined && value !== '';
}

/**
 * Whether the environment says it is CI: `CI` set to anything but `false`
 * or `0` (`CI=false` is how a CI flag is turned off).
 *
 * @param env - Environment variables
 * @returns True in CI
 */
function isCi(env: NodeJS.ProcessEnv): boolean {
  return isSet(env, 'CI') && !['false', '0'].includes(env['CI']?.toLowerCase() ?? '');
}

/**
 * Whether a display is available for Chrome's window: on Linux an X11 or
 * Wayland display (`DISPLAY`, `WAYLAND_DISPLAY`; WSLg sets them too), on
 * macOS the desktop unless the shell came in over SSH (`SSH_CONNECTION`,
 * `SSH_TTY`) or runs in CI (`CI`, unless `false` or `0`). Servers, containers and CI stay headless.
 *
 * @param env - Environment variables
 * @param platform - Operating system (`process.platform`)
 * @returns True when Chrome should show a window by default
 */
export function hasDisplay(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform === 'darwin') {
    return !isSet(env, 'SSH_CONNECTION') && !isSet(env, 'SSH_TTY') && !isCi(env);
  }
  return isSet(env, 'DISPLAY') || isSet(env, 'WAYLAND_DISPLAY');
}
