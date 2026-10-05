/**
 * Network command messages (bdg network list)
 *
 * User-facing messages for the network list command output and formatting.
 */

/**
 * Generate message for following network output.
 *
 * @returns Status message for stderr
 */
export function followingNetworkMessage(): string {
  return 'Following network requests... (Ctrl+C to stop)';
}

/**
 * Generate message when stopping network follow mode.
 *
 * @returns Status message for stderr
 */
export function stoppedFollowingNetworkMessage(): string {
  return '\nStopped following network requests.';
}

/**
 * Note after a header value the server sent more than once.
 *
 * @param count - Times it was sent
 * @returns e.g. `(sent 2 times)`
 */
export function headerRepeatedNote(count: number): string {
  return `(sent ${count} times)`;
}

/**
 * Note after a loopback remote address of a request to another host: Chrome
 * connected to a proxy on this machine, not to the server.
 *
 * @returns Note text
 */
export function localProxyNote(): string {
  return '(local proxy)';
}
