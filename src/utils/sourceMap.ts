/**
 * Source maps (#848, part 2): enough of version 3 to turn an original
 * `file:line[:col]` into the generated line and column of its first mapping
 * segment, so a logpoint can be set in a bundle by the file the agent knows.
 */

import { scriptUrlPattern } from '@/utils/logpointLocation.js';

/** A map that cannot be used, with the reason */
export class SourceMapError extends Error {}

/** One decoded segment, every number 0-based */
export interface MappingSegment {
  genLine: number;
  genColumn: number;
  /** Index into `sources` (absent in a segment that has only a generated column) */
  source?: number;
  origLine?: number;
  origColumn?: number;
  /** Index into `names` */
  name?: number;
}

/** The parts of a map the lookup reads */
export interface SourceMap {
  sources: string[];
  sourceRoot: string;
  mappings: string;
  /** Original text of each source, when the map carries it (`''` where it does not) */
  sourcesContent?: string[];
}

/** A place in the generated code, 1-based */
export interface GeneratedPosition {
  line: number;
  column: number;
  /** The map source that matched, resolved to a URL */
  source: string;
  /** The original line it stands for, 1-based */
  originalLine: number;
  /** A `return` break location at this place would be this original line's own */
  ownsReturnSlot: boolean;
  /** The line's other segments in this source, by generated position (at most {@link MAX_ALTERNATIVES}) */
  alternatives: Array<{ line: number; column: number; ownsReturnSlot: boolean }>;
}

/** Other generated positions of an original line a lookup keeps */
const MAX_ALTERNATIVES = 32;

/** What {@link lookupGenerated} found */
export type GeneratedLookup =
  | { kind: 'found'; positions: GeneratedPosition[] }
  | { kind: 'no-source' }
  | { kind: 'no-code'; source: string };

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bits of a VLQ digit that carry value; the digit's next bit says "more digits follow" */
const VLQ_VALUE_BITS = 5;
const VLQ_CONTINUE = 1 << VLQ_VALUE_BITS;

/** Past this shift a value no longer fits a 32-bit integer */
const VLQ_MAX_SHIFT = 30;

/**
 * Decode a run of base64 VLQ values.
 *
 * @param text - Digits
 * @returns The signed integers they encode
 * @throws SourceMapError for a character outside base64 or a value cut short
 */
export function decodeVlq(text: string): number[] {
  const values: number[] = [];
  let accumulated = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new SourceMapError(`"${char}" is not a base64 digit`);
    accumulated += (digit & (VLQ_CONTINUE - 1)) * 2 ** shift;
    if (digit & VLQ_CONTINUE) {
      shift += VLQ_VALUE_BITS;
      if (shift > VLQ_MAX_SHIFT) throw new SourceMapError('a VLQ value is too large');
      continue;
    }
    const magnitude = Math.floor(accumulated / 2);
    values.push(accumulated % 2 === 1 ? -magnitude : magnitude);
    accumulated = 0;
    shift = 0;
  }
  if (shift > 0) throw new SourceMapError('a VLQ value is cut short');
  return values;
}

/**
 * Decode the `mappings` string segment by segment.
 *
 * @param mappings - Mappings as in the map
 * @yields Segments in the order they are written (empty segments skipped)
 * @throws SourceMapError for a segment of 2, 3 or more than 5 fields, or invalid digits
 */
export function* decodeMappings(mappings: string): Generator<MappingSegment> {
  let source = 0;
  let origLine = 0;
  let origColumn = 0;
  let name = 0;
  const lines = mappings.split(';');
  for (const [genLine, line] of lines.entries()) {
    let genColumn = 0;
    for (const text of line.split(',')) {
      if (text === '') continue;
      const fields = decodeVlq(text);
      if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
        throw new SourceMapError(
          `a mapping segment has ${fields.length} fields (1, 4 or 5 expected)`
        );
      }
      genColumn += fields[0] ?? 0;
      if (fields.length === 1) {
        yield { genLine, genColumn };
        continue;
      }
      source += fields[1] ?? 0;
      origLine += fields[2] ?? 0;
      origColumn += fields[3] ?? 0;
      if (fields.length === 5) name += fields[4] ?? 0;
      yield {
        genLine,
        genColumn,
        source,
        origLine,
        origColumn,
        ...(fields.length === 5 && { name }),
      };
    }
  }
}

/**
 * Parse a source map file.
 *
 * @param text - File content (a leading `)]}'` line is dropped)
 * @returns The map
 * @throws SourceMapError for invalid JSON, another version, or `sections`
 */
export function parseSourceMap(text: string): SourceMap {
  const body = text.startsWith(")]}'") ? text.slice(text.indexOf('\n') + 1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SourceMapError('not valid JSON');
  }
  const map = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  if (Array.isArray(map['sections'])) {
    throw new SourceMapError('an indexed map (sections) is not supported');
  }
  if (map['version'] !== 3) {
    throw new SourceMapError(
      `source map version ${String(map['version'])} is not supported (3 is)`
    );
  }
  if (typeof map['mappings'] !== 'string') throw new SourceMapError('the map has no mappings');
  if (!Array.isArray(map['sources'])) throw new SourceMapError('the map has no sources');
  return {
    sources: map['sources'].map((source: unknown) => (typeof source === 'string' ? source : '')),
    sourceRoot: typeof map['sourceRoot'] === 'string' ? map['sourceRoot'] : '',
    mappings: map['mappings'],
    ...(Array.isArray(map['sourcesContent']) && {
      sourcesContent: (map['sourcesContent'] as unknown[]).map((text) =>
        typeof text === 'string' ? text : ''
      ),
    }),
  };
}

/**
 * A map source as a URL: joined to `sourceRoot`, resolved against the map.
 *
 * @param source - Entry of `sources`
 * @param sourceRoot - The map's `sourceRoot`
 * @param baseUrl - URL of the map (of the script for an inline map)
 * @returns Absolute URL, or the joined text when it is not a URL
 */
export function resolveSource(source: string, sourceRoot: string, baseUrl: string): string {
  try {
    const root = sourceRoot === '' ? baseUrl : new URL(withSlash(sourceRoot), baseUrl).href;
    return new URL(source, root).href;
  } catch {
    return sourceRoot === '' ? source : `${withSlash(sourceRoot)}${source}`;
  }
}

/**
 * Text ending with one slash.
 *
 * @param path - Directory-like text
 * @returns `path/`, or `path` when it ends with a slash
 */
function withSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

/** Original lines are numbered below this inside an index key */
const LINE_STRIDE = 2 ** 26;

/** A map read once: resolved sources and, per original line, its segments */
export interface SourceMapIndex {
  /** `sources` resolved to URLs */
  sources: string[];
  /** Segments by original line (`source * LINE_STRIDE + line`): `[genLine, genColumn, origColumn, …]` */
  lines: Map<number, number[]>;
  /** Length of the `mappings` text, for budgeting caches */
  size: number;
  /** Original lines (`source * LINE_STRIDE + line`) whose text starts with `return` */
  returnLines: Set<number>;
  /** Original lines whose text mentions `return` */
  mentionReturn: Set<number>;
}

/** Fields of a stored segment: generated line and column, original column, and the previous segment's original line (`-1`: none) */
const SEGMENT_FIELDS = 4;

/**
 * Original lines that start with, or mention, `return` (known only for
 * sources the map carries the text of).
 *
 * @param map - Parsed map
 * @returns Both sets of line keys
 */
function returnLinesOf(map: SourceMap): { starts: Set<number>; mentions: Set<number> } {
  const starts = new Set<number>();
  const mentions = new Set<number>();
  (map.sourcesContent ?? []).forEach((text, source) => {
    text.split('\n').forEach((lineText, line) => {
      if (!/\breturn\b/.test(lineText)) return;
      mentions.add(source * LINE_STRIDE + line);
      if (/^\s*return\b/.test(lineText)) starts.add(source * LINE_STRIDE + line);
    });
  });
  return { starts, mentions };
}

/**
 * Read a map's segments once, so any number of lookups need not decode it again.
 *
 * @param map - Parsed map
 * @param baseUrl - URL sources are resolved against
 * @returns Index
 */
export function indexSourceMap(map: SourceMap, baseUrl: string): SourceMapIndex {
  const lines = new Map<number, number[]>();
  let previous = -1;
  for (const segment of decodeMappings(map.mappings)) {
    if (segment.source === undefined || segment.origLine === undefined) continue;
    const key = segment.source * LINE_STRIDE + segment.origLine;
    const stored = lines.get(key);
    const entry = [segment.genLine, segment.genColumn, segment.origColumn ?? 0, previous];
    previous = key;
    if (stored) stored.push(...entry);
    else lines.set(key, entry);
  }
  const { starts, mentions } = returnLinesOf(map);
  return {
    sources: map.sources.map((source) =>
      source === '' ? '' : resolveSource(source, map.sourceRoot, baseUrl)
    ),
    lines,
    size: map.mappings.length,
    returnLines: starts,
    mentionReturn: mentions,
  };
}

/**
 * Whether segment `candidate` is a better start for the requested place than `best`.
 *
 * @param candidate - Segment on the requested original line
 * @param best - Best so far, if any
 * @param column - 0-based original column asked for, if any
 * @returns True when `candidate` replaces `best`
 */
function isBetter(
  candidate: MappingSegment,
  best: MappingSegment | undefined,
  column: number | undefined
): boolean {
  if (!best) return true;
  const earlier =
    candidate.genLine < best.genLine ||
    (candidate.genLine === best.genLine && candidate.genColumn < best.genColumn);
  if (column === undefined) return earlier;
  const candidateColumn = candidate.origColumn ?? 0;
  const bestColumn = best.origColumn ?? 0;
  const candidateFits = candidateColumn <= column;
  const bestFits = bestColumn <= column;
  if (candidateFits !== bestFits) return candidateFits;
  if (candidateColumn === bestColumn) return earlier;
  return candidateFits ? candidateColumn > bestColumn : candidateColumn < bestColumn;
}

/** A return slot at a segment is its original line's own */
type OwnsSlot = (previous: number) => boolean;

/**
 * The other generated positions of an original line, by generated position.
 *
 * @param entry - The line's `[genLine, genColumn, origColumn, previous]` segments
 * @param chosen - The segment lookup picked
 * @param owns - Whether a return slot after the previous segment is the line's own
 * @returns 1-based positions without the chosen one
 */
function alternativesOf(
  entry: number[],
  chosen: MappingSegment,
  owns: OwnsSlot
): GeneratedPosition['alternatives'] {
  const others: GeneratedPosition['alternatives'] = [];
  for (let at = 0; at < entry.length; at += SEGMENT_FIELDS) {
    const line = (entry[at] ?? 0) + 1;
    const column = (entry[at + 1] ?? 0) + 1;
    if (line === chosen.genLine + 1 && column === chosen.genColumn + 1) continue;
    others.push({ line, column, ownsReturnSlot: owns(entry[at + 3] ?? -1) });
  }
  others.sort((a, b) => a.line - b.line || a.column - b.column);
  return others
    .filter(
      (place, at) =>
        at === 0 || place.line !== others[at - 1]?.line || place.column !== others[at - 1]?.column
    )
    .slice(0, MAX_ALTERNATIVES);
}

/**
 * Where an original line starts in the generated code: for each source the
 * file names, its first generated position on that line (with a column, the
 * segment at or before it, else the line's first).
 *
 * @param index - Indexed map
 * @param matcher - Matches the resolved sources the file names ({@link scriptUrlPattern})
 * @param line - 1-based original line
 * @param column - 1-based original column, when given
 * @returns Positions (one per matching source with code on the line), or why there is none
 */
export function lookupIndexed(
  index: SourceMapIndex,
  matcher: RegExp,
  line: number,
  column?: number
): GeneratedLookup {
  const wanted = index.sources.flatMap((url, source) => (matcher.test(url) ? [source] : []));
  if (wanted.length === 0) return { kind: 'no-source' };
  const zeroBasedColumn = column === undefined ? undefined : column - 1;
  const positions: GeneratedPosition[] = [];
  for (const source of wanted) {
    const ownKey = source * LINE_STRIDE + line - 1;
    const entry = index.lines.get(ownKey);
    const owns: OwnsSlot = (previous) =>
      previous === ownKey ||
      previous === -1 ||
      (index.returnLines.has(ownKey) && !index.mentionReturn.has(previous));
    let best: (MappingSegment & { previous: number }) | undefined;
    for (let at = 0; entry && at < entry.length; at += SEGMENT_FIELDS) {
      const candidate = {
        genLine: entry[at] ?? 0,
        genColumn: entry[at + 1] ?? 0,
        origColumn: entry[at + 2] ?? 0,
        previous: entry[at + 3] ?? -1,
      };
      if (isBetter(candidate, best, zeroBasedColumn)) best = candidate;
    }
    if (best) {
      positions.push({
        line: best.genLine + 1,
        column: best.genColumn + 1,
        source: index.sources[source] ?? '',
        originalLine: line,
        ownsReturnSlot: owns(best.previous),
        alternatives: alternativesOf(entry ?? [], best, owns),
      });
    }
  }
  if (positions.length > 0) return { kind: 'found', positions };
  return { kind: 'no-code', source: index.sources[wanted[0] ?? 0] ?? '' };
}

/**
 * {@link lookupIndexed} on a parsed map (indexes it first).
 *
 * @param map - Parsed map
 * @param baseUrl - URL sources are resolved against
 * @param file - File as typed (a path suffix of a source)
 * @param line - 1-based original line
 * @param column - 1-based original column, when given
 * @returns Positions, or why there is none
 */
export function lookupGenerated(
  map: SourceMap,
  baseUrl: string,
  file: string,
  line: number,
  column?: number
): GeneratedLookup {
  return lookupIndexed(
    indexSourceMap(map, baseUrl),
    new RegExp(scriptUrlPattern(file)),
    line,
    column
  );
}
