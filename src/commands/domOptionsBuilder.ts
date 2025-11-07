import { getNodeIdByIndex } from '@/session/queryCache.js';

import { parseSelectorOrIndex } from './domSelectorParser.js';

/**
 * Base interface for IPC options that accept selector, index, or nodeId
 */
export interface SelectorBasedOptions {
  selector?: string;
  index?: number;
  nodeId?: number;
}

/**
 * Build IPC request options from selector/index argument
 *
 * Handles three input methods:
 * 1. Direct nodeId (advanced users) - sets nodeId field
 * 2. Index from previous query - looks up nodeId from cache, sets index field
 * 3. CSS selector - sets selector field
 *
 * @param selectorOrIndex - CSS selector string or numeric index
 * @param nodeId - Optional direct nodeId (overrides selectorOrIndex)
 * @returns Options object with selector, index, or nodeId set
 * @throws Error When index is used but no cached element found at that index
 *
 * @example
 * ```typescript
 * // Direct nodeId (advanced)
 * buildSelectorOptions('.error', 123)  // → { nodeId: 123 }
 *
 * // Index from cache
 * buildSelectorOptions('2', undefined) // → { index: 2 } (if cache has index 2)
 *
 * // CSS selector
 * buildSelectorOptions('.error', undefined) // → { selector: '.error' }
 * ```
 */
export function buildSelectorOptions<T extends SelectorBasedOptions>(
  selectorOrIndex: string,
  nodeId: number | undefined
): T {
  const options = {} as T;

  // Direct nodeId takes precedence (advanced users)
  if (nodeId !== undefined) {
    options.nodeId = nodeId;
    return options;
  }

  // Parse as selector or index
  const parsed = parseSelectorOrIndex(selectorOrIndex);

  if (parsed.type === 'index') {
    // Look up nodeId from cache
    const cachedNodeId = getNodeIdByIndex(parsed.value as number);
    if (!cachedNodeId) {
      throw new Error(
        `No cached element at index ${parsed.value}. Run 'bdg dom query <selector>' first.`
      );
    }
    options.index = parsed.value as number;
  } else {
    // Use selector directly
    options.selector = parsed.value as string;
  }

  return options;
}

/**
 * Merge base options with selector-based options.
 *
 * Convenience helper that combines buildSelectorOptions with base options object.
 * Eliminates the repeated pattern of:
 * ```
 * const selectorOpts = buildSelectorOptions(...);
 * Object.assign(ipcOptions, selectorOpts);
 * ```
 *
 * @param baseOptions - Base IPC options object
 * @param selectorOrIndex - CSS selector or cached index
 * @param nodeId - Optional direct nodeId
 * @returns Merged options object with selector/index/nodeId added
 *
 * @example
 * ```typescript
 * // Instead of:
 * const ipcOptions = { color: 'red', opacity: 0.5 };
 * const selectorOptions = buildSelectorOptions('.error', undefined);
 * Object.assign(ipcOptions, selectorOptions);
 *
 * // Use:
 * const ipcOptions = mergeWithSelector(
 *   { color: 'red', opacity: 0.5 },
 *   '.error',
 *   undefined
 * );
 * // → { color: 'red', opacity: 0.5, selector: '.error' }
 * ```
 */
export function mergeWithSelector<T extends SelectorBasedOptions>(
  baseOptions: T,
  selectorOrIndex: string,
  nodeId: number | undefined
): T {
  const selectorOptions = buildSelectorOptions<T>(selectorOrIndex, nodeId);
  return { ...baseOptions, ...selectorOptions };
}
