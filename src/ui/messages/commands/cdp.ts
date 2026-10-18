/**
 * CDP messages.
 */

/**
 * Warning for a `bdg cdp` method the bundled protocol lacks, sent anyway.
 *
 * @param method - Method sent
 * @param protocolVersion - Bundled devtools-protocol version
 * @returns Warning text
 */
export function cdpUnlistedMethodWarning(method: string, protocolVersion: string): string {
  return `${method} is not in the bundled protocol (devtools-protocol ${protocolVersion}); sending it to Chrome as is`;
}

/**
 * `bdg cdp --describe` line for a redirect to a method the protocol lacks
 * (e.g. Page.deleteCookie names Network.deleteCookie).
 *
 * @param method - Redirect target
 * @returns Line text
 */
export function cdpUnresolvedRedirectLine(method: string): string {
  return `Redirect target ${method} is not in the protocol (unresolved redirect)`;
}

/**
 * `bdg cdp --describe` title of a redirect to a method the protocol has.
 *
 * @param method - Redirect target
 * @returns Title text
 */
export function cdpRedirectTitle(method: string): string {
  return `Implemented by ${method} (redirect)`;
}

/**
 * Lines of `bdg cdp --help` saying how names are matched (each short
 * enough not to be wrapped).
 */
export const CDP_EXECUTION_HELP =
  '  Execution: bundled methods are case-insensitive (network.getcookies works)\n' +
  '  Other methods are sent as typed (case-sensitive)';
