/**
 * DOM read error messages.
 */

import type { DomFrame } from '@/ipc/protocol/commands.js';
import type { OptionNotFound } from '@/ipc/protocol/domTypes.js';
import type { IndexSource } from '@/types.js';
import { joinLines } from '@/ui/formatting.js';
import { frameLabel, frameUrlLabel } from '@/ui/messages/commands.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { type ErrorWithSuggestion, shellQuote, usableIndexRange } from './shared.js';

/**
 * No element has the given node id.
 *
 * @param nodeId - Backend node id given with --node-id
 */
export function nodeIdNotFoundError(nodeId: number): ErrorWithSuggestion {
  return {
    message: `No element with node id ${nodeId} in the page`,
    suggestion:
      'Get current node ids with "bdg dom query <selector>" or "bdg dom get <selector> --raw"',
  };
}

/**
 * An element in the page whose presence check failed in Chrome.
 *
 * @param nodeId - Backend node id of the element
 * @param cause - Chrome's error, if it gave one
 * @returns Message and suggestion
 */
export function nodeCheckFailedError(nodeId: number, cause?: string): ErrorWithSuggestion {
  return {
    message: `Could not check element ${nodeId} in the page${cause ? `: ${cause}` : ''}`,
    suggestion: 'Retry the command; if it keeps failing, run "bdg status --verbose"',
  };
}

/**
 * The list an index refers to, in words.
 *
 * @param source - Where the index comes from
 * @returns e.g. `index 0 of the last dom query "h3"`, `index 2 of the last dom form`
 */
export function indexSourceText(source: IndexSource): string {
  return `index ${source.index} of ${cachedListText(source)}`;
}

/**
 * An output with, first, the line naming the list an index resolved against
 * (for outputs without an element row), so an index meant for one list and
 * resolved against another is never silent.
 *
 * @param output - Formatted output
 * @param source - The index and its list; none for a selector argument
 * @returns e.g. `From index 0 of the last dom query "h3"` above the output
 */
export function withIndexSourceLine(output: string, source?: IndexSource): string {
  return joinLines(source && `From ${indexSourceText(source)}`, output);
}

/**
 * The cached list an index refers to, in words.
 *
 * @param source - Where the index comes from
 * @returns e.g. `the last dom query "h3"`
 */
function cachedListText(source: IndexSource): string {
  const query = source.query === undefined ? '' : ` "${source.query}"`;
  return `the last ${source.command}${query}`;
}

/**
 * The command that refreshes the list an index refers to.
 *
 * @param source - Where the index comes from
 * @returns e.g. `bdg dom query 'h3'`
 */
function refreshCommand(source: IndexSource): string {
  if (source.query === undefined) return sessionCommand(`bdg ${source.command}`);
  return sessionCommand(`bdg ${source.command} ${shellQuote(source.query)}`);
}

/** Why an element's cross-origin iframe could not be placed in the page */
export type FrameMappingProblem = 'no-box' | 'rotated' | 'unreadable';

/**
 * An element of a cross-origin iframe (from an a11y query) whose iframe
 * could not be placed in the top-level viewport, so a mouse event or layout
 * would land in the wrong place.
 *
 * @param problem - The iframe or element has no box, is rotated or skewed, or could not be read
 * @param detail - Underlying error, if any
 * @returns Message and suggestion
 */
export function frameMappingError(
  problem: FrameMappingProblem,
  detail?: string
): ErrorWithSuggestion {
  const reasons = {
    'no-box': 'neither the element nor its iframe document has a box (hidden or removed)',
    rotated: 'the iframe is rotated or skewed, which bdg cannot map',
    unreadable: `it could not be measured${detail ? ` (${detail})` : ''}`,
  };
  return {
    message: `Cannot place the element's cross-origin iframe in the page: ${reasons[problem]}`,
    suggestion: `Act inside the frame instead: ${sessionCommand('bdg dom frames')}, then ${sessionCommand('bdg eval --frame <n> \'document.querySelector("…").click()\'')}`,
  };
}

/**
 * A cached node is gone (page navigated or the element was removed).
 *
 * @param index - Index the user gave, if any
 * @param source - The list the index refers to, when known
 * @returns Message and suggestion
 */
export function staleNodeError(index?: number, source?: IndexSource): ErrorWithSuggestion {
  if (source) {
    return {
      message: `The element at ${indexSourceText(source)} is no longer in the page (it was removed or the page navigated)`,
      suggestion: `Re-run "${refreshCommand(source)}" to get fresh indices`,
    };
  }
  const element = index === undefined ? 'The element' : `The element at index ${index}`;
  return {
    message: `${element} is no longer in the page (it was removed or the page navigated)`,
    suggestion: 'Re-run "bdg dom query <selector>" (or "bdg dom form") to get fresh indices',
  };
}

/**
 * An index beyond the cached results.
 *
 * @param source - The index and the list it refers to
 * @param count - Number of cached results
 * @param total - Matches the query found, when more than it cached (`dom query` caches the first 1000)
 * @returns Message and suggestion
 */
export function cachedIndexOutOfRangeError(
  source: IndexSource,
  count: number,
  total?: number
): ErrorWithSuggestion {
  if (total !== undefined && total > count && source.index < total) {
    return {
      message: `Index ${source.index} is past the ${count} matches of ${cachedListText(source)} that can be used by index (${total} in all)`,
      suggestion: `Re-run it with --limit ${source.index + 1} (or --limit 0) to index that many`,
    };
  }
  const all = total !== undefined && total > count ? total : count;
  const results = all === 1 ? '1 result' : `${all} results`;
  const range =
    all > count
      ? `or up to ${all - 1} after re-running it with --limit 0`
      : `or re-run "${refreshCommand(source)}"`;
  return {
    message: `Index ${source.index} is out of range for ${cachedListText(source)} (${results})`,
    suggestion:
      count > 0 ? `${usableIndexRange(count)}, ${range}` : `Re-run "${refreshCommand(source)}"`,
  };
}

/**
 * An index into a list that is empty: the last query matched nothing (it
 * leaves an empty list so an earlier query's indices are not used by mistake).
 *
 * @param source - The index and the list it refers to
 * @returns e.g. `The last dom query "#x" matched nothing, so it has no index 0`
 */
export function emptyCachedListError(source: IndexSource): ErrorWithSuggestion {
  const list = cachedListText(source);
  const outcome = source.command === 'dom form' ? 'found no forms' : 'matched nothing';
  return {
    message: `T${list.slice(1)} ${outcome}, so it has no index ${source.index}`,
    suggestion: `Run a query that matches elements, e.g. "${sessionCommand('bdg dom query <selector>')}", then use its indices`,
  };
}

/**
 * An index in a session that has run no query yet (each session starts
 * without cached results).
 *
 * @returns Message and suggestion
 */
export function noQueryInSessionError(): ErrorWithSuggestion {
  return {
    message:
      'No query in this session yet: an index refers to the last dom query, dom form or dom a11y query of the session',
    suggestion: `Run "${sessionCommand('bdg dom query <selector>')}" first to get indexed results`,
  };
}

/**
 * Unknown field in an a11y query pattern.
 *
 * @param field - The unrecognized key
 * @param similar - A known field it looks like a typo of
 * @param value - The `name=…`/`description=…` field that absorbed it
 */
export function unknownQueryFieldError(
  field: string,
  similar?: string,
  value?: string
): ErrorWithSuggestion {
  const usage =
    "Use role, name or description, e.g. bdg dom a11y query 'role=button name=Sign in'. Quote the whole pattern for the shell; a name with spaces or colons goes last ('name=E-mail address:') or in inner quotes ('name=\"Role: admin\" role=textbox')";
  if (!similar) return { message: `Unknown query field: "${field}"`, suggestion: usage };
  const [key = '', ...text] = (value ?? '').split('=');
  return {
    message: `Unknown query field: "${field}" (did you mean "${similar}"?)`,
    suggestion: `Fix the field name, e.g. ${similar}=…; if the ${key} really contains "${field}:", put it in inner quotes: '${key}="${text.join('=')}"'`,
  };
}

/**
 * No a11y nodes matching pattern.
 */
export function noA11yNodesFoundError(pattern: string): ErrorWithSuggestion {
  return {
    message: 'No nodes found matching pattern',
    suggestion: `Pattern: ${pattern}. Try a broader query or use "bdg dom a11y tree" to see all elements`,
  };
}

/**
 * An element that exists but has no node in the accessibility tree.
 *
 * @param target - Selector or index the user gave
 * @param reasons - Why Chrome leaves it out
 */
export function notInAccessibilityTreeError(
  target: string,
  reasons: string[]
): ErrorWithSuggestion {
  return {
    message: `${target} exists but is not in the accessibility tree${reasons.length ? ` (${reasons.join('; ')})` : ''}`,
    suggestion: `Screen readers skip it. Inspect its HTML instead: bdg dom get ${/^\d+$/.test(target) ? target : `'${target}'`}`,
  };
}

/** How to see the frames `--frame` accepts */
const LIST_FRAMES_HINT = 'List frames: bdg dom frames';

/**
 * `eval --frame` given an empty frame.
 */
export function emptyFrameError(): ErrorWithSuggestion {
  return {
    message: 'The frame is empty',
    suggestion: `Pass an index, a name/id attribute, or part of the name, id or URL. ${LIST_FRAMES_HINT}`,
  };
}

/**
 * `eval --frame` matching no iframe.
 *
 * @param query - Requested frame
 * @param frames - Frames of the page
 */
export function frameNotFoundError(query: string, frames: DomFrame[]): ErrorWithSuggestion {
  if (frames.length === 0) {
    return { message: `Frame not found: ${query}`, suggestion: 'The page has no iframes' };
  }
  return {
    message: `Frame not found: ${query}`,
    suggestion: joinLines('Available frames:', ...frames.map((frame) => `  ${frameLabel(frame)}`)),
  };
}

/**
 * A `eval --frame` index that names another frame (or none) than when
 * `bdg dom frames` listed it.
 *
 * @param index - Requested index
 */
export function staleFrameIndexError(index: number): ErrorWithSuggestion {
  return {
    message: `Frame index ${index} is stale: the page's iframes changed since bdg dom frames listed them`,
    suggestion:
      'Re-run bdg dom frames to refresh the indices, or pick the frame by name, id or URL (--frame <name>)',
  };
}

/**
 * `eval --frame` matching more than one iframe.
 *
 * @param query - Requested frame
 * @param candidates - Matching frames
 */
export function ambiguousFrameError(query: string, candidates: DomFrame[]): ErrorWithSuggestion {
  return {
    message: `Frame "${query}" matches ${candidates.length} frames`,
    suggestion: joinLines(
      'Pick one by index, or a longer part of the name, id or URL:',
      ...candidates.map((frame) => `  ${frameLabel(frame)}`)
    ),
  };
}

/**
 * An iframe without a JavaScript context (still loading, or gone).
 *
 * @param url - Frame URL
 */
export function frameNotReadyError(url: string): ErrorWithSuggestion {
  return {
    message: `The frame has no JavaScript context: ${frameUrlLabel(url)}`,
    suggestion: `Wait for it to load and retry, or re-run bdg dom frames: the frame may no longer exist`,
  };
}

/**
 * `--why all`: `all` resets every property, so there is no one cascade to show.
 *
 * @returns Message and suggestion
 */
export function whyAllPropertyError(): ErrorWithSuggestion {
  return {
    message: '--why takes one property; "all" resets every property',
    suggestion:
      'Name the property you are after (e.g. --why color), or use --all to list the set ones',
  };
}

/**
 * Names given to --props or --why that are not CSS properties.
 *
 * @param names - Unknown names
 * @param suggestions - Closest known names
 * @returns Message and suggestion
 */
export function unknownCssPropertyError(
  names: string[],
  suggestions: string[]
): ErrorWithSuggestion {
  const plural = names.length > 1;
  return {
    message: `Unknown CSS ${plural ? 'properties' : 'property'}: ${names.join(', ')}`,
    suggestion:
      suggestions.length > 0
        ? `Did you mean: ${suggestions.join(', ')}?`
        : 'Use CSS property names as in a stylesheet (e.g. --props padding-top,color,--brand); bdg dom inspect <selector> --all lists the set ones',
  };
}

/**
 * The browser does not offer `DOMDebugger.getEventListeners` (non-Chrome
 * targets, or browsers that disable the DOMDebugger domain).
 *
 * @param detail - Chrome's error
 * @returns Message and suggestion
 */
export function eventListenersUnavailableError(detail: string): ErrorWithSuggestion {
  return {
    message: `This browser cannot list event listeners (DOMDebugger.getEventListeners: ${detail})`,
    suggestion: 'Use a Chromium-based browser (Chrome, Edge) that supports the DOMDebugger domain',
  };
}

/**
 * An unknown `dom audit` check.
 *
 * @param value - Name given
 * @param similar - Closest names
 * @param checks - Every check
 * @returns Message
 */
export function unknownAuditCheckMessage(
  value: string,
  similar: string[],
  checks: readonly string[]
): string {
  return `Unknown check "${value}"${similar.length > 0 ? `; did you mean ${similar[0]}?` : ''} (checks: ${checks.join(', ')})`;
}

/**
 * `dom fill` found no option of a select matching the value. For a select
 * that holds a secret only the number of options is given (#625).
 *
 * @param notFound - What the page reported
 * @returns Error with suggestion
 */
export function optionNotFoundError(notFound: OptionNotFound): ErrorWithSuggestion {
  const { count, value, options } = notFound;
  if (value === undefined || options === undefined) {
    return {
      message: 'Option not found',
      suggestion: `${count} ${count === 1 ? 'option' : 'options'} available (the options of a secret select are not listed)`,
    };
  }
  return {
    message: `Option not found: ${value}`,
    suggestion: `Available options: ${options.join(', ')}`,
  };
}
