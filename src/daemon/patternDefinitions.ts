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
    threshold: 2,
    alternative: 'bdg dom query <selector>',
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
    name: 'multiple_runtime_evaluations',
    cdpMethods: ['Runtime.evaluate'],
    threshold: 4,
    alternative: 'bdg dom eval <javascript>',
  },
  {
    name: 'network_body_fetching',
    cdpMethods: ['Network.getResponseBody'],
    threshold: 3,
    alternative: 'bdg details network <id>',
  },
];

/**
 * Get pattern by name.
 *
 * @param name - Pattern identifier
 * @returns Pattern definition if found, undefined otherwise
 */
export function getPattern(name: string): PatternDefinition | undefined {
  return PATTERNS.find((p) => p.name === name);
}

/**
 * Get all patterns.
 *
 * @returns Complete pattern registry
 */
export function getAllPatterns(): PatternDefinition[] {
  return PATTERNS;
}

/**
 * Find patterns matching a CDP method.
 *
 * @param method - CDP method name (e.g., "Runtime.evaluate")
 * @returns Matching pattern definitions
 */
export function findPatternsForMethod(method: string): PatternDefinition[] {
  return PATTERNS.filter((p) => p.cdpMethods.includes(method));
}
