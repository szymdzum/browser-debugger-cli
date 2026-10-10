/**
 * Pattern definitions for detecting verbose CDP usage.
 *
 * Defines patterns that indicate agents are using verbose CDP commands
 * when more efficient high-level wrapper commands are available.
 */

/**
 * Pattern definition for detecting verbose CDP usage.
 */
export interface PatternDefinition {
  /** Pattern identifier */
  name: string;
  /** CDP methods that trigger this pattern */
  cdpMethods: string[];
  /**
   * Only calls whose `expression` param matches count (absent: every call of
   * the methods). A pattern with one is more specific than one without
   */
  expressionPattern?: RegExp;
  /** Number of occurrences before showing hint */
  threshold: number;
  /** Suggested high-level alternative command */
  alternative: string;
}

/**
 * Registry of all detectable patterns.
 *
 * Each pattern tracks specific CDP method usage and suggests
 * efficient alternatives when threshold is reached.
 */
export const PATTERNS: PatternDefinition[] = [
  {
    name: 'dom_query_with_evaluate',
    cdpMethods: ['Runtime.evaluate'],
    expressionPattern: /querySelector|getElementsBy|getElementById/,
    threshold: 2,
    alternative: 'bdg dom query <selector>',
  },
  {
    name: 'runtime_evaluate',
    cdpMethods: ['Runtime.evaluate'],
    threshold: 2,
    alternative: 'bdg dom eval <javascript>',
  },
  {
    name: 'screenshot_with_cdp',
    cdpMethods: ['Page.captureScreenshot'],
    threshold: 1,
    alternative: 'bdg dom screenshot [path]',
  },
  {
    name: 'cookies_with_cdp',
    cdpMethods: ['Network.getAllCookies', 'Network.getCookies'],
    threshold: 1,
    alternative: 'bdg network getCookies',
  },
  {
    name: 'network_body_fetching',
    cdpMethods: ['Network.getResponseBody'],
    threshold: 3,
    alternative: 'bdg details network <id>',
  },
];

/**
 * Find patterns matching a CDP call.
 *
 * @param method - CDP method name, matched case-insensitively (e.g., "Runtime.evaluate")
 * @param params - The call's params, matched against a pattern's `expressionPattern`
 * @returns Matching pattern definitions
 */
export function findPatternsForMethod(
  method: string,
  params: Record<string, unknown> = {}
): PatternDefinition[] {
  const normalized = method.toLowerCase();
  const expression = typeof params['expression'] === 'string' ? params['expression'] : '';
  return PATTERNS.filter(
    (p) =>
      p.cdpMethods.some((m) => m.toLowerCase() === normalized) &&
      (!p.expressionPattern || p.expressionPattern.test(expression))
  );
}
