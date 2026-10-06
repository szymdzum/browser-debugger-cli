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
 * Whether a display is available for Chrome's window: on Linux an X11 or
 * Wayland display (`DISPLAY`, `WAYLAND_DISPLAY`; WSLg sets them too), on
 * macOS the desktop unless the shell came in over SSH (`SSH_CONNECTION`,
 * `SSH_TTY`) or runs in CI (`CI`). Servers, containers and CI stay headless.
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
    return !isSet(env, 'SSH_CONNECTION') && !isSet(env, 'SSH_TTY') && !isSet(env, 'CI');
  }
  return isSet(env, 'DISPLAY') || isSet(env, 'WAYLAND_DISPLAY');
}
