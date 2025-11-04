/**
 * Result of parsing a selector or index argument
 */
export interface ParsedSelector {
  type: 'selector' | 'index';
  value: string | number;
}

/**
 * Parse argument as either CSS selector or index
 *
 * @param arg - Argument to parse (e.g., ".error" or "1")
 * @returns Parsed result indicating type and value
 *
 * @example
 * parseSelectorOrIndex(".error") // \{ type: 'selector', value: '.error' \}
 * parseSelectorOrIndex("1")      // \{ type: 'index', value: 1 \}
 * parseSelectorOrIndex("42")     // \{ type: 'index', value: 42 \}
 */
export function parseSelectorOrIndex(arg: string): ParsedSelector {
  // If arg is a positive integer, treat as index
  if (/^\d+$/.test(arg)) {
    return { type: 'index', value: parseInt(arg, 10) };
  }

  // Otherwise treat as CSS selector
  return { type: 'selector', value: arg };
}
