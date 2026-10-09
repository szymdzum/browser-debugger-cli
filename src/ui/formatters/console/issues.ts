/**
 * The Issues block of `bdg console`: Chrome Issues of the page currently
 * loaded, one line each (reason, then the element or file:line), at most
 * {@link ISSUES_SHOWN} with a note for the rest.
 */

import { ISSUES_SHOWN, MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type { PageIssue } from '@/types.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import type { OutputFormatter } from '@/ui/formatting.js';
import { moreIssuesNote } from '@/ui/messages/issueMessages.js';

import { formatSourceLocation } from './shared.js';

/** Elements named per issue line (the rest are counted) */
const ELEMENTS_SHOWN = 3;

/**
 * The elements at fault, e.g. `input#a, input#a` or `label, label, label +2 more`.
 *
 * @param issue - Issue with elements
 * @returns Text, undefined while none is described
 */
function elementList(issue: PageIssue): string | undefined {
  const named = (issue.nodes ?? []).flatMap((node) => node.description ?? []);
  if (named.length === 0) return undefined;
  const shown = named.slice(0, ELEMENTS_SHOWN);
  const more = (issue.count ?? named.length) - shown.length;
  return more > 0 ? `${shown.join(', ')} +${more} more` : shown.join(', ');
}

/**
 * Where an issue is: the elements at fault, else its file:line:column (a
 * document without a position is its URL).
 *
 * @param issue - Issue
 * @returns Location text, undefined when Chrome gave none
 */
function issueLocation(issue: PageIssue): string | undefined {
  const elements = elementList(issue);
  if (elements) return elements;
  const { source } = issue;
  if (!source) return undefined;
  return formatSourceLocation([
    {
      url: source.url,
      lineNumber: source.line === undefined ? -1 : source.line - 1,
      columnNumber: source.column === undefined ? -1 : source.column - 1,
    },
  ]);
}

/**
 * One issue as a line: its reason (cut like console texts unless `--full`)
 * and where it is.
 *
 * @param issue - Issue
 * @param full - `--full`
 * @returns Line
 */
function formatIssueLine(issue: PageIssue, full: boolean | undefined): string {
  const location = issueLocation(issue);
  const text = capForDisplay(issue.text, MAX_CONSOLE_TEXT_LENGTH, full);
  return location ? `• ${text} → ${location}` : `• ${text}`;
}

/**
 * Render the Issues block (nothing when the page has none).
 *
 * @param fmt - Output
 * @param issues - Issues of the page, in the order they arrived
 * @param dropped - Issues of the page not kept at the per-page limit
 * @param full - `--full`
 */
export function renderIssuesSection(
  fmt: OutputFormatter,
  issues: readonly PageIssue[] | undefined,
  dropped: number | undefined,
  full: boolean | undefined
): void {
  if (!issues?.length) return;
  const shown = issues.slice(0, ISSUES_SHOWN);
  const more = issues.length - shown.length;
  fmt.text(`Issues (${issues.length + (dropped ?? 0)})`);
  fmt.separator('─', 30);
  for (const issue of shown) fmt.text(formatIssueLine(issue, full));
  if (more > 0 || dropped) fmt.text(moreIssuesNote(more, dropped ?? 0));
  fmt.blank();
}
