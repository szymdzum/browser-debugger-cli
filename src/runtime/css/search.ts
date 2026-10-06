/**
 * `bdg css search <text>`: find text in the page's stylesheets, cross-origin
 * ones included (CDP reads every stylesheet's text), and show the rule
 * around each match with its `file:line`.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { CssSearchMatch, CssSearchResult } from '@/ipc/protocol/auditTypes.js';
import type { CssSearchCommand } from '@/ipc/protocol/commands.js';
import { enableStyleDomains } from '@/runtime/dom/inspect.js';
import { stylesheetPositionLabel, styleSheetHeaders } from '@/runtime/dom/inspectRules.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Matches listed without `--limit` */
export const DEFAULT_CSS_SEARCH_LIMIT = 20;

/** Characters of a rule shown around a match */
const RULE_CONTEXT = 240;

/**
 * Search the stylesheets for a text (case-insensitive).
 *
 * @param cdp - CDP connection
 * @param params - Text and limit
 * @returns Matches with their place
 */
export async function searchStyleSheets(
  cdp: CDPConnection,
  params: CssSearchCommand
): Promise<CssSearchResult> {
  await enableStyleDomains(cdp);
  const headers = [...styleSheetHeaders(cdp)].filter((header) => header.origin !== 'user-agent');
  const limit = params.limit ?? DEFAULT_CSS_SEARCH_LIMIT;
  const matches: CssSearchMatch[] = [];
  let total = 0;
  for (const header of headers) {
    const text = await sheetText(cdp, header.styleSheetId);
    for (const match of findInSheet(text, params.query)) {
      total++;
      if (matches.length < limit) {
        matches.push({
          source: stylesheetPositionLabel(header, match.line, match.column),
          text: match.rule,
        });
      }
    }
  }
  return { query: params.query, sheets: headers.length, total, matches };
}

/**
 * A stylesheet's text; empty when Chrome cannot give it.
 *
 * @param cdp - CDP connection
 * @param styleSheetId - Stylesheet
 * @returns Text
 */
async function sheetText(cdp: CDPConnection, styleSheetId: string): Promise<string> {
  try {
    const response = (await cdp.send('CSS.getStyleSheetText', {
      styleSheetId,
    })) as Protocol.CSS.GetStyleSheetTextResponse;
    return response.text;
  } catch (error) {
    log.debug(`No text for stylesheet ${styleSheetId}: ${getErrorMessage(error)}`);
    return '';
  }
}

/**
 * Where a text occurs in a stylesheet (case-insensitive), each with the
 * rule around it: from the end of the previous rule to the end of this one,
 * whitespace collapsed and cut to {@link RULE_CONTEXT} characters.
 *
 * @param text - Stylesheet text
 * @param query - Text to find
 * @returns 0-based line and column of each match, and its rule
 */
export function findInSheet(
  text: string,
  query: string
): Array<{ line: number; column: number; rule: string }> {
  const found: Array<{ line: number; column: number; rule: string }> = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (needle === '') return found;
  for (
    let at = haystack.indexOf(needle);
    at >= 0;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    const before = text.slice(0, at);
    const line = before.split('\n').length - 1;
    const column = at - (before.lastIndexOf('\n') + 1);
    const start = Math.max(text.lastIndexOf('}', at) + 1, at - RULE_CONTEXT);
    const close = text.indexOf('}', at);
    const end = Math.min(close < 0 ? text.length : close + 1, at + RULE_CONTEXT);
    found.push({ line, column, rule: text.slice(start, end).replace(/\s+/g, ' ').trim() });
  }
  return found;
}
