/**
 * Playwright-compatible selector support for bdg.
 *
 * Transforms Playwright-style selectors (`:has-text()`, `:text()`, `:text-is()`, `:visible`)
 * into standard CSS selectors plus JavaScript filter functions that can be executed
 * in the browser context.
 *
 * @example
 * // Input: "button:has-text('Submit')"
 * // Output: cssSelector="button", jsFilter checks text content
 */

import {
  createParser,
  render,
  ast,
  traverse,
  type AstSelector,
  type AstPseudoClass,
  type AstEntity,
  type AstRule,
} from 'css-selector-parser';

/**
 * Custom pseudo-classes supported by bdg (Playwright-compatible).
 */
const CUSTOM_PSEUDO_CLASSES = new Set(['has-text', 'text', 'text-is', 'visible']);

/**
 * Result of transforming a selector.
 */
export interface TransformedSelector {
  /** Standard CSS selector (can be used with querySelectorAll) */
  cssSelector: string;
  /** JavaScript filter expression to apply after CSS query, or null if not needed */
  jsFilter: string | null;
  /** Whether custom pseudo-classes were found and transformed */
  hasCustomSelectors: boolean;
  /** List of custom pseudo-classes found */
  customPseudoClasses: string[];
}

/**
 * Extracted custom pseudo-class info.
 */
interface CustomPseudoInfo {
  name: string;
  argument: string | null;
}

/**
 * Create CSS selector parser configured to accept unknown pseudo-classes.
 */
const parser = createParser({
  syntax: {
    baseSyntax: 'progressive',
    pseudoClasses: {
      unknown: 'accept',
      definitions: {
        String: ['has-text', 'text', 'text-is'],
        NoArgument: ['visible'],
      },
    },
  },
});

/**
 * Normalize whitespace in text for matching (like Playwright does).
 * Collapses multiple whitespace to single space and trims.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Escape a string for use in JavaScript code.
 */
function escapeJsString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Generate JavaScript filter expression for a custom pseudo-class.
 */
function generateJsFilter(pseudo: CustomPseudoInfo): string {
  const arg = pseudo.argument ? escapeJsString(normalizeWhitespace(pseudo.argument)) : '';

  switch (pseudo.name) {
    case 'has-text':
      // Element contains text anywhere in subtree (case-insensitive)
      return `el.textContent?.toLowerCase().includes('${arg.toLowerCase()}')`;

    case 'text':
      // Smallest element containing text (case-insensitive substring match)
      // Check that element's direct text content matches, not just descendants
      return `(() => {
        const text = '${arg.toLowerCase()}';
        const elText = el.textContent?.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
        if (!elText.includes(text)) return false;
        // Check no child has the complete match (we want the smallest container)
        for (const child of el.children) {
          const childText = child.textContent?.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
          if (childText.includes(text)) return false;
        }
        return true;
      })()`;

    case 'text-is':
      // Exact text match (case-sensitive, whitespace-normalized)
      return `el.textContent?.replace(/\\s+/g, ' ').trim() === '${arg}'`;

    case 'visible':
      // Element is visible (not hidden, has dimensions)
      return `(() => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })()`;

    default:
      // Unknown pseudo-class, return true (no filtering)
      return 'true';
  }
}

/**
 * Check if a pseudo-class is one of our custom ones.
 */
function isCustomPseudoClass(name: string): boolean {
  return CUSTOM_PSEUDO_CLASSES.has(name);
}

/**
 * Strip surrounding quotes from a string value.
 * The css-selector-parser library includes quotes in string values.
 */
function stripQuotes(str: string): string {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Extract argument from pseudo-class AST node.
 */
function extractPseudoArgument(pseudo: AstPseudoClass): string | null {
  if (!pseudo.argument) return null;

  if (ast.isString(pseudo.argument)) {
    // Parser includes quotes in string value, strip them
    return stripQuotes(pseudo.argument.value);
  }

  // For other argument types, render them back to string
  return render(pseudo.argument);
}

/**
 * Deep clone an AST entity and filter out custom pseudo-classes from rules.
 */
function cloneAndFilterAst(entity: AstEntity): AstEntity {
  if (ast.isSelector(entity)) {
    return ast.selector({
      rules: entity.rules.map((rule) => cloneAndFilterAst(rule) as AstRule),
    });
  }

  if (ast.isRule(entity)) {
    // Filter out custom pseudo-classes from items
    const filteredItems = entity.items.filter((item) => {
      if (ast.isPseudoClass(item) && isCustomPseudoClass(item.name)) {
        return false;
      }
      return true;
    });

    // Clone each remaining item
    const clonedItems = filteredItems.map((item) => cloneAndFilterAst(item));

    const rule = ast.rule({
      items: clonedItems as AstRule['items'],
    });

    // Handle combinator and nestedRule
    if (entity.combinator) {
      rule.combinator = entity.combinator;
    }
    if (entity.nestedRule) {
      rule.nestedRule = cloneAndFilterAst(entity.nestedRule) as AstRule;
    }

    return rule;
  }

  // For other node types, return as-is (they're leaf nodes or don't need filtering)
  return entity;
}

/**
 * Transform a Playwright-style selector into standard CSS + JS filter.
 *
 * Supports:
 * - `:has-text("text")` - Element contains text (case-insensitive)
 * - `:text("text")` - Smallest element with text (case-insensitive)
 * - `:text-is("text")` - Exact text match (case-sensitive)
 * - `:visible` - Element is visible
 *
 * @param selector - Playwright-style selector string
 * @returns Transformed selector with CSS and optional JS filter
 * @throws Error if selector cannot be parsed
 *
 * @example
 * transformSelector('button:has-text("Submit")')
 * // Returns TransformedSelector with cssSelector='button' and jsFilter for text matching
 */
export function transformSelector(selector: string): TransformedSelector {
  let parsed: AstSelector;

  try {
    parsed = parser(selector);
  } catch {
    // If parsing fails, return original selector (let browser handle the error)
    return {
      cssSelector: selector,
      jsFilter: null,
      hasCustomSelectors: false,
      customPseudoClasses: [],
    };
  }

  const customPseudos: CustomPseudoInfo[] = [];

  // Walk AST to find and collect custom pseudo-classes
  traverse(parsed, (node: AstEntity) => {
    if (ast.isPseudoClass(node) && isCustomPseudoClass(node.name)) {
      customPseudos.push({
        name: node.name,
        argument: extractPseudoArgument(node),
      });
    }
  });

  if (customPseudos.length === 0) {
    // No custom pseudo-classes, return original selector
    return {
      cssSelector: selector,
      jsFilter: null,
      hasCustomSelectors: false,
      customPseudoClasses: [],
    };
  }

  // Clone AST and filter out custom pseudo-classes
  const filteredAst = cloneAndFilterAst(parsed);

  // Render the filtered AST back to CSS string
  let cssSelector = render(filteredAst);

  // Handle edge case: if all items were removed, use '*' as fallback
  if (!cssSelector || cssSelector.trim() === '') {
    cssSelector = '*';
  }

  // Generate combined JS filter from all custom pseudo-classes
  const filters = customPseudos.map((pseudo) => generateJsFilter(pseudo));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const jsFilter = filters.length === 1 ? filters[0]! : `(${filters.join(') && (')})`;

  return {
    cssSelector,
    jsFilter,
    hasCustomSelectors: true,
    customPseudoClasses: customPseudos.map((p) => p.name),
  };
}

/**
 * Generate a complete JavaScript expression that queries and filters elements.
 *
 * This generates code that can be executed via CDP Runtime.evaluate to find
 * elements matching the Playwright-style selector.
 *
 * @param selector - Playwright-style selector string
 * @returns JavaScript code string to execute in browser context
 *
 * @example
 * generateQueryScript('button:has-text("Submit")')
 * // Returns query script that filters by text content
 */
export function generateQueryScript(selector: string): string {
  const transformed = transformSelector(selector);

  const cssSelector = escapeJsString(transformed.cssSelector);

  if (!transformed.jsFilter) {
    // No custom filtering needed
    return `[...document.querySelectorAll('${cssSelector}')]`;
  }

  // Query with CSS, then filter with JS
  return `[...document.querySelectorAll('${cssSelector}')].filter(el => ${transformed.jsFilter})`;
}

/**
 * Check if a selector contains any Playwright-style custom pseudo-classes.
 *
 * Quick check without full parsing - useful for deciding whether to use
 * standard CDP DOM.querySelectorAll or custom JS evaluation.
 *
 * @param selector - CSS selector string
 * @returns true if selector likely contains custom pseudo-classes
 */
export function hasPlaywrightSelectors(selector: string): boolean {
  // Quick regex check for common patterns
  return /:(?:has-text|text-is|text|visible)\s*(?:\(|$)/.test(selector);
}
