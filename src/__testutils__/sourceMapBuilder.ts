/**
 * Builds source maps for tests and fixture pages (#848): the encoder that
 * pairs with the decoder in `src/utils/sourceMap.ts`, so a test can say
 * "this generated text came from that original line" and get a map back.
 */

/** One mapping segment, every number 0-based */
export interface SegmentSpec {
  genLine: number;
  genColumn: number;
  /** Index into `sources` */
  source: number;
  origLine: number;
  origColumn: number;
}

/** A segment placed by finding text in the generated code */
export interface Anchor {
  /** 0-based generated line */
  genLine: number;
  /** The segment starts where this text first appears on that line */
  needle: string;
  /** Index into `sources` */
  source: number;
  /** 1-based original line, as an editor numbers it */
  origLine: number;
  /** 0-based original column */
  origColumn?: number;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 VLQ encoding of one signed integer.
 *
 * @param value - Integer
 * @returns Digits
 */
export function encodeVlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let digits = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    digits += BASE64[digit];
  } while (rest > 0);
  return digits;
}

/**
 * The `mappings` string of segments (any order).
 *
 * @param segments - Segments
 * @returns Encoded mappings
 */
export function encodeMappings(segments: SegmentSpec[]): string {
  const sorted = [...segments].sort((a, b) => a.genLine - b.genLine || a.genColumn - b.genColumn);
  const last = { source: 0, origLine: 0, origColumn: 0 };
  const lines: string[][] = [];
  let previousColumn = 0;
  let currentLine = -1;
  for (const segment of sorted) {
    while (lines.length <= segment.genLine) lines.push([]);
    if (segment.genLine !== currentLine) {
      currentLine = segment.genLine;
      previousColumn = 0;
    }
    lines[segment.genLine]?.push(
      [
        segment.genColumn - previousColumn,
        segment.source - last.source,
        segment.origLine - last.origLine,
        segment.origColumn - last.origColumn,
      ]
        .map(encodeVlq)
        .join('')
    );
    previousColumn = segment.genColumn;
    Object.assign(last, {
      source: segment.source,
      origLine: segment.origLine,
      origColumn: segment.origColumn,
    });
  }
  return lines.map((line) => line.join(',')).join(';');
}

/**
 * Segments for anchors: each starts where its text is in the generated line.
 *
 * @param generated - Generated code, split into lines
 * @param anchors - Where each original line starts
 * @returns Segments
 * @throws Error when a needle is not on its line
 */
export function anchorSegments(generated: string[], anchors: Anchor[]): SegmentSpec[] {
  return anchors.map((anchor) => {
    const genColumn = (generated[anchor.genLine] ?? '').indexOf(anchor.needle);
    if (genColumn < 0) throw new Error(`"${anchor.needle}" is not on line ${anchor.genLine}`);
    return {
      genLine: anchor.genLine,
      genColumn,
      source: anchor.source,
      origLine: anchor.origLine - 1,
      origColumn: anchor.origColumn ?? 0,
    };
  });
}

/**
 * A version 3 source map as JSON.
 *
 * @param options - Sources and mappings (`sourceRoot` optional)
 * @returns JSON text
 */
export function buildSourceMap(options: {
  sources: string[];
  segments: SegmentSpec[];
  sourceRoot?: string;
}): string {
  return JSON.stringify({
    version: 3,
    ...(options.sourceRoot !== undefined && { sourceRoot: options.sourceRoot }),
    sources: options.sources,
    names: [],
    mappings: encodeMappings(options.segments),
  });
}

/**
 * A script's comment that points at an inline source map.
 *
 * @param mapJson - Source map JSON
 * @returns `//# sourceMappingURL=data:...` line
 */
export function inlineMapComment(mapJson: string): string {
  return `//# sourceMappingURL=data:application/json;base64,${Buffer.from(mapJson).toString('base64')}`;
}
