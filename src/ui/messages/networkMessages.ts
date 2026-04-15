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
