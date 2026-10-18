/**
 * Source maps (#848, part 2): enough of version 3 to turn an original
 * `file:line[:col]` into the generated line and column of its first mapping
 * segment, so a logpoint can be set in a bundle by the file the agent knows.
 */

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
}

/** A place in the generated code, 1-based */
export interface GeneratedPosition {
  line: number;
  column: number;
  /** The map source that matched, resolved to a URL */
  source: string;
  /** The original line it stands for, 1-based */
  originalLine: number;
}

/** What {@link lookupGenerated} found */
export type GeneratedLookup =
  | { kind: 'found'; positions: GeneratedPosition[] }
  | { kind: 'no-source' }
  | { kind: 'no-code'; source: string };

/**
 * Decode a run of base64 VLQ values.
 *
 * @param text - Digits
 * @returns The signed integers they encode
 * @throws SourceMapError for a character outside base64 or a value cut short
 */
export function decodeVlq(text: string): number[] {
  throw new Error(`not implemented: ${text}`);
}

/**
 * Decode the `mappings` string segment by segment.
 *
 * @param mappings - Mappings as in the map
 * @returns Segments in the order they are written
 * @throws SourceMapError for a segment of 2 or 3 fields, or invalid digits
 */
export function decodeMappings(mappings: string): Iterable<MappingSegment> {
  throw new Error(`not implemented: ${mappings}`);
}

/**
 * Parse a source map file.
 *
 * @param text - File content (a leading `)]}'` line is dropped)
 * @returns The map
 * @throws SourceMapError for invalid JSON, another version, or `sections`
 */
export function parseSourceMap(text: string): SourceMap {
  throw new Error(`not implemented: ${text}`);
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
  throw new Error(`not implemented: ${source} ${sourceRoot} ${baseUrl}`);
}

/**
 * Where an original line starts in the generated code.
 *
 * @param map - Parsed map
 * @param baseUrl - URL sources are resolved against
 * @param file - File as typed (a path suffix of a source)
 * @param line - 1-based original line
 * @param column - 1-based original column, when given
 * @returns Positions (one per matching source), or why there is none
 */
export function lookupGenerated(
  map: SourceMap,
  baseUrl: string,
  file: string,
  line: number,
  column?: number
): GeneratedLookup {
  throw new Error(`not implemented: ${map.mappings} ${baseUrl} ${file} ${line} ${column}`);
}
