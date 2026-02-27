/**
 * Format eval result for human-readable display.
 *
 * @param data - Eval result containing the evaluated value
 * @returns Formatted JSON string
 *
 * @example
 * ```typescript
 * formatEval({ result: 'My Page Title' });
 * // Output: "My Page Title"
 *
 * formatEval({ result: { url: 'https://example.com', title: 'Example' } });
 * // Output:
 * // {
 * //   "url": "https://example.com",
 * //   "title": "Example"
 * // }
 * ```
 */
export function formatEval(data: { result: unknown }): string {
  return JSON.stringify(data.result, null, 2);
}
