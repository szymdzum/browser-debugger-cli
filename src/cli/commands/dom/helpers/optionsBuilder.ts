import { getNodeIdByIndex } from './domCache.js';
import { parseSelectorOrIndex } from './selectorParser.js';

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
 * @throws \{Error\} When index is used but no cached element found at that index
 *
 * @example
 * // Direct nodeId (advanced)
 * buildSelectorOptions('.error', 123)  // → \{ nodeId: 123 \}
 *
 * // Index from cache
 * buildSelectorOptions('2', undefined) // → \{ index: 2 \} (if cache has index 2)
 *
 * // CSS selector
 * buildSelectorOptions('.error', undefined) // → \{ selector: '.error' \}
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
