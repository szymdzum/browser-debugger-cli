/**
 * Chrome Issues (the DevTools Issues panel, `Audits.issueAdded`) that explain
 * why a page looks or behaves wrong without a console message: quirks mode,
 * form markup errors, stylesheets that failed to load, `eval` blocked by CSP,
 * element content-model errors and cookies `document.cookie` could not set.
 *
 * Form errors and element content errors are one issue per kind, listing
 * the elements at fault (Chrome reports each element, and form errors twice).
 * Everything else Chrome reports (performance hints, lazy-load images,
 * third-party cookie phaseout warnings, deprecations, request-bound cookie and
 * CORS problems the console already shows) is dropped: on a news site it is
 * hundreds of issues. Issues belong to the page load: a main-frame navigation
 * clears them. Only the page's own session is listened to, so cross-origin
 * iframes (mostly ads and trackers) add none.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { MAX_ISSUE_NODES, MAX_ISSUE_TEXT_LENGTH, MAX_PAGE_ISSUES } from '@/constants.js';
import type { CleanupFunction, IssueNode, PageIssue } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  FORM_ERROR_TEXTS,
  cookieIssueText,
  cspIssueText,
  elementAccessibilityIssueText,
  quirksModeIssueText,
  stylesheetIssueText,
} from '@/ui/messages/issueMessages.js';
import { getErrorMessage } from '@/utils/errors.js';
import { truncateByLength } from '@/utils/strings.js';

type InspectorIssue = Protocol.Audits.InspectorIssue;
type IssueDetails = Protocol.Audits.InspectorIssueDetails;
type SourceCodeLocation = Protocol.Audits.SourceCodeLocation;

const log = createLogger('console');

/** CSP violations without a console message of their own */
const UNLOGGED_CSP_VIOLATIONS = new Set<Protocol.Audits.ContentSecurityPolicyViolationType>([
  'kEvalViolation',
  'kTrustedTypesSinkViolation',
  'kTrustedTypesPolicyViolation',
]);

/**
 * Reports remembered per page to tell Chrome's repeats apart (past this,
 * repeats count as more elements)
 */
const MAX_SEEN_KEYS = 10_000;

/**
 * Cap a text to {@link MAX_ISSUE_TEXT_LENGTH} characters.
 *
 * @param text - Text
 * @returns The text, cut with an ellipsis when too long
 */
function capped(text: string): string {
  return truncateByLength(text, MAX_ISSUE_TEXT_LENGTH);
}

/**
 * A source position as 1-based line and column.
 *
 * @param location - Chrome's 0-based position
 * @returns Source of the issue
 */
function sourceOf(location: SourceCodeLocation): NonNullable<PageIssue['source']> {
  return {
    url: capped(location.url),
    line: location.lineNumber + 1,
    column: location.columnNumber + 1,
  };
}

/** An issue bdg keeps, as Chrome reported it once */
interface IssueReport {
  /** The issue without its elements */
  issue: Omit<PageIssue, 'nodes' | 'count'>;
  /** Element at fault, and the attribute at fault when Chrome names one */
  node?: { backendNodeId: number; attribute?: string | undefined };
  /** Reports of one kind on several elements are one issue (e.g. each field with a duplicate id) */
  groupByKind?: boolean;
}

/** A report as converted from Chrome's details (the code is added after) */
type ConvertedReport = Omit<IssueReport, 'issue'> & {
  issue: Omit<IssueReport['issue'], 'code'>;
};

/**
 * The report of each kind bdg keeps, from Chrome's details (undefined: dropped).
 */
const CONVERTERS: Partial<
  Record<Protocol.Audits.InspectorIssueCode, (details: IssueDetails) => ConvertedReport | undefined>
> = {
  QuirksModeIssue: ({ quirksModeIssueDetails: d }) =>
    d && {
      issue: { text: quirksModeIssueText(d.isLimitedQuirksMode), source: { url: capped(d.url) } },
    },
  GenericIssue: ({ genericIssueDetails: d }) => {
    const text = d ? FORM_ERROR_TEXTS[d.errorType] : undefined;
    if (!d || !text) return undefined;
    return {
      issue: { type: d.errorType, text },
      groupByKind: true,
      ...(d.violatingNodeId !== undefined && {
        node: { backendNodeId: d.violatingNodeId, attribute: d.violatingNodeAttribute },
      }),
    };
  },
  StylesheetLoadingIssue: ({ stylesheetLoadingIssueDetails: d }) =>
    d && {
      issue: {
        type: d.styleSheetLoadingIssueReason,
        text: stylesheetIssueText(d.styleSheetLoadingIssueReason, d.failedRequestInfo),
        source: sourceOf(d.sourceCodeLocation),
      },
    },
  ContentSecurityPolicyIssue: ({ contentSecurityPolicyIssueDetails: d }) =>
    d && UNLOGGED_CSP_VIOLATIONS.has(d.contentSecurityPolicyViolationType)
      ? {
          issue: {
            type: d.contentSecurityPolicyViolationType,
            text: cspIssueText(
              d.contentSecurityPolicyViolationType,
              d.violatedDirective,
              d.isReportOnly
            ),
            ...(d.sourceCodeLocation && { source: sourceOf(d.sourceCodeLocation) }),
          },
          ...(d.violatingNodeId !== undefined && { node: { backendNodeId: d.violatingNodeId } }),
        }
      : undefined,
  ElementAccessibilityIssue: ({ elementAccessibilityIssueDetails: d }) =>
    d && {
      issue: {
        type: d.elementAccessibilityIssueReason,
        text: elementAccessibilityIssueText(
          d.elementAccessibilityIssueReason,
          d.hasDisallowedAttributes
        ),
      },
      node: { backendNodeId: d.nodeId },
      groupByKind: true,
    },
  CookieIssue: ({ cookieIssueDetails: d }) =>
    d?.operation === 'SetCookie' && !d.request && d.cookieExclusionReasons.length > 0
      ? {
          issue: {
            type: d.cookieExclusionReasons.join(','),
            text: cookieIssueText(
              d.cookie?.name ?? d.rawCookieLine ?? '',
              d.cookieExclusionReasons
            ),
            ...(d.cookieUrl && { source: { url: capped(d.cookieUrl) } }),
          },
        }
      : undefined,
};

/**
 * The report of an issue, if its kind is one bdg keeps.
 *
 * @param issue - Issue Chrome reported
 * @returns Report with a one-line reason (capped), or undefined when dropped
 */
function toReport(issue: InspectorIssue): IssueReport | undefined {
  const converted = CONVERTERS[issue.code]?.(issue.details);
  if (!converted) return undefined;
  return {
    ...converted,
    issue: { code: issue.code, ...converted.issue, text: capped(converted.issue.text) },
  };
}

/**
 * The issue as bdg keeps it, if its kind is one bdg keeps.
 *
 * @param issue - Issue Chrome reported
 * @returns The issue (on its one element, if any), or undefined when dropped
 */
export function toPageIssue(issue: InspectorIssue): PageIssue | undefined {
  const report = toReport(issue);
  return report && newPageIssue(report);
}

/**
 * A kept issue from its first report.
 *
 * @param report - Report
 * @returns Issue
 */
function newPageIssue({ issue, node }: IssueReport): PageIssue {
  return node
    ? { ...issue, nodes: [{ backendNodeId: node.backendNodeId }], count: 1 }
    : { ...issue };
}

/** An element newly recorded for an issue, to be described */
export interface RecordedNode {
  node: IssueNode;
  /** Attribute at fault, when Chrome names one */
  attribute?: string;
}

/**
 * Issues of the page currently loaded: allowlisted kinds only, each once
 * (Chrome sends form issues twice), one per kind for form errors and
 * element content errors (with the elements at fault), the first
 * {@link MAX_PAGE_ISSUES}.
 */
export class PageIssueLog {
  private readonly kept: PageIssue[] = [];
  /** Kept issues by grouping key */
  private readonly groups = new Map<string, PageIssue>();
  /** Reports seen, to drop Chrome's repeats */
  private readonly seen = new Set<string>();
  private droppedCount = 0;

  /** Issues kept, in the order they arrived */
  get issues(): readonly PageIssue[] {
    return this.kept;
  }

  /** Distinct issues of the page not kept past {@link MAX_PAGE_ISSUES} */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Add an issue Chrome reported.
   *
   * @param issue - Issue
   * @returns The issue it was recorded in, with the element newly recorded
   *   (to describe), or undefined when dropped or a repeat
   */
  add(issue: InspectorIssue): { issue: PageIssue; recorded?: RecordedNode } | undefined {
    const report = toReport(issue);
    if (!report) return undefined;
    const exactKey = `${issue.code}|${JSON.stringify(issue.details)}`;
    if (this.seen.has(exactKey)) return undefined;
    if (this.seen.size < MAX_SEEN_KEYS) this.seen.add(exactKey);

    const groupKey = report.groupByKind ? `${issue.code}|${report.issue.type}` : exactKey;
    const existing = this.groups.get(groupKey);
    if (existing) return addNode(existing, report);
    if (this.kept.length >= MAX_PAGE_ISSUES) {
      this.droppedCount++;
      return undefined;
    }
    const pageIssue = newPageIssue(report);
    this.kept.push(pageIssue);
    this.groups.set(groupKey, pageIssue);
    const node = pageIssue.nodes?.[0];
    return { issue: pageIssue, ...(node && { recorded: recordedNode(node, report) }) };
  }

  /** Forget the issues (a new page was loaded). */
  clear(): void {
    this.kept.length = 0;
    this.groups.clear();
    this.seen.clear();
    this.droppedCount = 0;
  }
}

/**
 * An element to describe, with the attribute at fault.
 *
 * @param node - Element recorded
 * @param report - Its report
 * @returns Element to describe
 */
function recordedNode(node: IssueNode, report: IssueReport): RecordedNode {
  const attribute = report.node?.attribute;
  return attribute === undefined ? { node } : { node, attribute };
}

/**
 * Record another element of an issue kind (counted; kept up to
 * {@link MAX_ISSUE_NODES}).
 *
 * @param issue - Kept issue of the kind
 * @param report - Report on another element
 * @returns The issue, with the element when it was kept
 */
function addNode(
  issue: PageIssue,
  report: IssueReport
): { issue: PageIssue; recorded?: RecordedNode } | undefined {
  if (!report.node) return undefined;
  issue.count = (issue.count ?? 0) + 1;
  const nodes = (issue.nodes ??= []);
  if (nodes.length >= MAX_ISSUE_NODES) return { issue };
  const node: IssueNode = { backendNodeId: report.node.backendNodeId };
  nodes.push(node);
  return { issue, recorded: recordedNode(node, report) };
}

/**
 * Short description of an element, e.g. `label[for="missing"]` or `input#email`.
 *
 * @param node - Node Chrome described
 * @param attribute - Attribute at fault, if any
 * @returns Description
 */
function describeElement(node: Protocol.DOM.Node, attribute?: string): string {
  const attributes = new Map<string, string>();
  const list = node.attributes ?? [];
  for (let i = 0; i + 1 < list.length; i += 2)
    attributes.set(list[i] as string, list[i + 1] as string);
  const id = attributes.get('id');
  const value = attribute === undefined ? undefined : attributes.get(attribute);
  const name = node.localName || node.nodeName.toLowerCase();
  const idPart = id ? `#${id}` : '';
  const attributePart =
    attribute && attribute !== 'id' && value !== undefined ? `[${attribute}="${value}"]` : '';
  return capped(`${name}${idPart}${attributePart}`);
}

/**
 * Describe an element of an issue (asynchronously; the issue is kept
 * meanwhile).
 *
 * @param typed - Typed CDP connection
 * @param recorded - Element recorded, with the attribute at fault
 */
function describeNode(typed: TypedCDPConnection, { node, attribute }: RecordedNode): void {
  typed
    .send('DOM.describeNode', { backendNodeId: node.backendNodeId })
    .then((result) => {
      node.description = describeElement(result.node, attribute);
    })
    .catch((error: unknown) => log.debug(`Issue element not described: ${getErrorMessage(error)}`));
}

/**
 * Start collecting the page's Chrome Issues into `issues`.
 *
 * @param cdp - CDP connection to the page
 * @param issues - Issue log (cleared on each main-frame navigation)
 * @returns Cleanup that stops collecting
 */
export async function startIssueCollection(
  cdp: CDPConnection,
  issues: PageIssueLog
): Promise<CleanupFunction> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);

  registry.registerTyped(typed, 'Audits.issueAdded', ({ issue }, sessionId) => {
    if (sessionId !== undefined) return;
    const recorded = issues.add(issue)?.recorded;
    if (recorded) describeNode(typed, recorded);
  });
  registry.registerTyped(typed, 'Page.frameNavigated', ({ frame }, sessionId) => {
    if (sessionId === undefined && frame.parentId === undefined) issues.clear();
  });

  try {
    await typed.send('Audits.enable', {});
  } catch (error) {
    log.debug(`Chrome Issues unavailable: ${getErrorMessage(error)}`);
  }
  return () => registry.cleanup();
}
