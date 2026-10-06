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
  const texts = await Promise.all(headers.map((header) => sheetText(cdp, header.styleSheetId)));
  const matches: CssSearchMatch[] = [];
  let total = 0;
  headers.forEach((header, i) => {
    const found = findInSheet(texts[i] ?? '', params.query, Number.POSITIVE_INFINITY);
    const seen = new Set<string>();
    for (const match of found.matches) {
      if (seen.has(match.rule)) continue;
      seen.add(match.rule);
      total++;
      if (matches.length >= limit) continue;
      matches.push({
        source: stylesheetPositionLabel(header, match.line, match.column),
        text: match.rule,
      });
    }
  });
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
 * Where a text occurs in a stylesheet (case-insensitive): how many times,
 * and for the first `limit` matches the 0-based line and column and the
 * rule around it (from the end of the previous rule to the end of this one,
 * whitespace collapsed, at most {@link RULE_CONTEXT} characters each side).
 * Lines are counted as the search moves on, so a big sheet is read once.
 *
 * @param text - Stylesheet text
 * @param query - Text to find
 * @param limit - Matches described at most
 * @returns Match count and the described matches
 */
export function findInSheet(
  text: string,
  query: string,
  limit = Number.POSITIVE_INFINITY
): { total: number; matches: Array<{ line: number; column: number; rule: string }> } {
  const matches: Array<{ line: number; column: number; rule: string }> = [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (needle === '') return { total: 0, matches };
  let total = 0;
  let line = 0;
  let lineStart = 0;
  let scanned = 0;
  for (
    let at = haystack.indexOf(needle);
    at >= 0;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    total++;
    if (matches.length >= limit) continue;
    for (let i = text.indexOf('\n', scanned); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) {
      line++;
      lineStart = i + 1;
    }
    scanned = at;
    matches.push({ line, column: at - lineStart, rule: ruleAround(text, at) });
  }
  return { total, matches };
}

/**
 * The rule around a position: whole when short, else its selector and the
 * declarations near the position (`.btn { … color: var(--brand); … }`),
 * whitespace collapsed.
 *
 * @param text - Stylesheet text
 * @param at - Position of the match
 * @returns Rule text
 */
function ruleAround(text: string, at: number): string {
  const ruleStart = text.lastIndexOf('}', at) + 1;
  const open = text.indexOf('{', ruleStart);
  const close = text.indexOf('}', at);
  const ruleEnd = close < 0 ? text.length : close + 1;
  const collapse = (part: string): string => part.replace(/\s+/g, ' ').trim();
  if (ruleEnd - ruleStart <= 2 * RULE_CONTEXT || open < 0 || open > at) {
    return collapse(
      text.slice(Math.max(ruleStart, at - RULE_CONTEXT), Math.min(ruleEnd, at + RULE_CONTEXT))
    );
  }
  const near = collapse(
    text.slice(
      Math.max(open + 1, at - RULE_CONTEXT / 2),
      Math.min(ruleEnd - 1, at + RULE_CONTEXT / 2)
    )
  );
  return `${collapse(text.slice(ruleStart, open))} { … ${near} … }`;
}
