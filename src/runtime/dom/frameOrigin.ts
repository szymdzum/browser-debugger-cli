/**
 * The origin a frame's scripts really run with, for `bdg dom frames`.
 *
 * Chrome reports `securityOrigin: "://"` for frames without an origin of
 * their own (srcdoc, about:blank, data:) and the URL's origin for sandboxed
 * frames, so neither tells whether the parent can reach the frame's
 * document. The frame's default execution context knows: it reports the
 * inherited origin for srcdoc and about:blank, and `"://"` for opaque ones
 * (data: URLs, sandboxes without `allow-same-origin`). A frame that has no
 * context yet falls back to the rules below; a frame inside an opaque one
 * counts as opaque too (sandbox flags are inherited).
 */

/** Origin of documents that share no origin with anything */
export const OPAQUE_ORIGIN = 'null';

/** What is known about a frame's origin */
export interface FrameOriginFacts {
  /** Frame URL */
  url: string;
  /** `Page.Frame.securityOrigin` */
  securityOrigin: string;
  /** Origin of the frame's default execution context, when it has one */
  contextOrigin?: string | undefined;
  /** Origin of the parent frame (already resolved) */
  parentOrigin?: string | undefined;
  /** `sandbox` attribute of the frame's element, when present */
  sandbox?: string | undefined;
}

/**
 * Whether a reported origin names a real (tuple) origin.
 *
 * @param origin - Origin as Chrome reports it
 * @returns False for `"://"`, `"null"` and empty
 */
function isTupleOrigin(origin: string | undefined): origin is string {
  return origin !== undefined && origin !== '' && origin !== '://' && origin !== OPAQUE_ORIGIN;
}

/**
 * Whether a `sandbox` attribute makes the frame's origin opaque.
 *
 * @param sandbox - Attribute value (undefined when the attribute is missing)
 * @returns True unless the attribute is missing or allows same-origin
 */
export function isOpaqueSandbox(sandbox: string | undefined): boolean {
  if (sandbox === undefined) return false;
  return !sandbox.toLowerCase().split(/\s+/).includes('allow-same-origin');
}

/**
 * The origin a frame's scripts run with.
 *
 * @param facts - What Chrome reports about the frame
 * @returns e.g. `https://example.com`, or `"null"` for an opaque origin
 */
export function effectiveFrameOrigin(facts: FrameOriginFacts): string {
  if (facts.contextOrigin !== undefined) {
    return isTupleOrigin(facts.contextOrigin) ? facts.contextOrigin : OPAQUE_ORIGIN;
  }
  if (isOpaqueSandbox(facts.sandbox) || facts.parentOrigin === OPAQUE_ORIGIN) return OPAQUE_ORIGIN;
  if (isTupleOrigin(facts.securityOrigin)) return facts.securityOrigin;
  const inherits = facts.url === '' || facts.url.startsWith('about:');
  return inherits && isTupleOrigin(facts.parentOrigin) ? facts.parentOrigin : OPAQUE_ORIGIN;
}

/**
 * Whether the top page's scripts cannot reach a frame's document.
 *
 * @param origin - The frame's effective origin
 * @param topOrigin - The page's effective origin
 * @returns True for a different or opaque origin
 */
export function isCrossOrigin(origin: string, topOrigin: string): boolean {
  return origin === OPAQUE_ORIGIN || origin !== topOrigin;
}
