/**
 * Source maps for logpoints (#848, part 2): fetching a script's map (external,
 * from the daemon with a plain `fetch`, or inline `data:`), indexing it once,
 * keeping the indexes of the page now loaded within a budget, and asking
 * them where an original `file:line[:col]` is in the generated code.
 */

import { createHash } from 'node:crypto';

import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { getErrorMessage } from '@/utils/errors.js';
import {
  indexSourceMap,
  lookupIndexed,
  parseSourceMap,
  SourceMapError,
  type SourceMapIndex,
} from '@/utils/sourceMap.js';

/** How long one map may take to arrive */
const FETCH_TIMEOUT_MS = 5000;

/** Largest map read (bytes) */
const MAX_MAP_BYTES = 50 * 1024 * 1024;

/** Maps fetched at the same time */
const FETCH_CONCURRENCY = 6;

/** Length of `mappings` text the cached indexes may add up to before the oldest go */
const CACHE_BUDGET = 16 * 1024 * 1024;

/** A script Chrome parsed, as far as maps are concerned */
export interface MappedScript {
  url: string;
  sourceMapURL?: string;
}

/** A script that points at a map */
export type ScriptWithMap = Required<MappedScript>;

/** Where Chrome is asked to set a logpoint's breakpoint (1-based) */
export interface BreakpointTarget {
  /** Exact script URL (a generated script) */
  url?: string;
  /** Pattern for script URLs (a file as typed) */
  urlRegex?: string;
  line: number;
  column?: number;
  /** The map source it stands for (set from a source map) */
  source?: string;
  /** {@link mapKey} of the script whose map gave it */
  mapKey?: string;
}

/** What asking the maps found */
export interface MapResolution {
  targets: BreakpointTarget[];
  /** A source the file names has no code at the line */
  noCode: boolean;
  /** Why maps could not be used, one per map */
  failures: string[];
}

/**
 * Identity of a script's map: the script and its map URL (an inline map
 * stands for its hash, not its megabytes).
 *
 * @param script - Script with a map
 * @returns Key
 */
export function mapKey(script: ScriptWithMap): string {
  const map = script.sourceMapURL.startsWith('data:')
    ? `data:${createHash('sha1').update(script.sourceMapURL).digest('hex')}`
    : script.sourceMapURL;
  return `${script.url}\n${map}`;
}

/**
 * The text of an inline `data:` map.
 *
 * @param url - `data:application/json;base64,…` (or percent-encoded)
 * @returns Decoded text
 * @throws SourceMapError for a URL without a payload
 */
function dataUrlText(url: string): string {
  const comma = url.indexOf(',');
  if (comma < 0) throw new SourceMapError('the data: URL has no payload');
  const payload = url.slice(comma + 1);
  return /;base64$/i.test(url.slice(0, comma))
    ? Buffer.from(payload, 'base64').toString('utf8')
    : decodeURIComponent(payload);
}

/**
 * Why a fetch failed, in a few words.
 *
 * @param error - What `fetch` threw
 * @returns Reason
 */
function fetchFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer in ${FETCH_TIMEOUT_MS / 1000}s`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  return getErrorMessage(cause ?? error);
}

/**
 * Fetch an external map.
 *
 * @param url - Absolute URL
 * @returns Text
 * @throws SourceMapError for a failed, refused or oversized answer
 */
async function fetchMapText(url: URL): Promise<string> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceMapError(`${url.protocol} maps are not fetched`);
  }
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new SourceMapError(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_MAP_BYTES) {
      throw new SourceMapError('the map is over 50 MB');
    }
    bytes = await response.arrayBuffer();
  } catch (error) {
    throw error instanceof SourceMapError ? error : new SourceMapError(fetchFailure(error));
  }
  if (bytes.byteLength > MAX_MAP_BYTES) throw new SourceMapError('the map is over 50 MB');
  return new TextDecoder().decode(bytes);
}

/**
 * Read and index the map a script points at.
 *
 * @param script - Script with a map
 * @returns The indexed map
 * @throws SourceMapError with the reason, naming the map
 */
async function loadIndex(script: ScriptWithMap): Promise<SourceMapIndex> {
  const inline = script.sourceMapURL.startsWith('data:');
  let name = inline ? `inline map of ${displayUrl(script.url)}` : script.sourceMapURL;
  try {
    if (inline) {
      return indexSourceMap(parseSourceMap(dataUrlText(script.sourceMapURL)), script.url);
    }
    const url = new URL(script.sourceMapURL, script.url);
    name = displayUrl(url.href);
    return indexSourceMap(parseSourceMap(await fetchMapText(url)), url.href);
  } catch (error) {
    throw new SourceMapError(`${name}: ${getErrorMessage(error)}`);
  }
}

/**
 * The maps of the page now loaded, read once each (a failed read is tried
 * again next time) and kept within a budget.
 */
export class SourceMapReader {
  private readonly loaded = new Map<string, Promise<SourceMapIndex>>();
  private readonly sizes = new Map<string, number>();
  private total = 0;
  private readonly limiter = new ConcurrencyLimiter(FETCH_CONCURRENCY);

  /** Forget what was read (a page load starts over; a rebuilt map is read again) */
  clear(): void {
    this.loaded.clear();
    this.sizes.clear();
    this.total = 0;
  }

  /**
   * A script's indexed map.
   *
   * @param script - Script with a map
   * @returns The index
   * @throws SourceMapError when the map cannot be read
   */
  index(script: ScriptWithMap): Promise<SourceMapIndex> {
    const key = mapKey(script);
    let loaded = this.loaded.get(key);
    if (!loaded) {
      loaded = this.limiter.run(() => loadIndex(script));
      this.loaded.set(key, loaded);
      loaded.then(
        (index) => this.remember(key, index.size),
        () => this.loaded.delete(key)
      );
    }
    return loaded;
  }

  /**
   * Targets in a generated script for an original place.
   *
   * @param index - The script's indexed map
   * @param script - The script
   * @param matcher - Matches the sources the file names
   * @param line - 1-based original line
   * @param column - 1-based original column, when given
   * @returns Its targets, and whether a source named has no code at the line
   */
  targetsIn(
    index: SourceMapIndex,
    script: ScriptWithMap,
    matcher: RegExp,
    line: number,
    column?: number
  ): { targets: BreakpointTarget[]; noCode: boolean } {
    const found = lookupIndexed(index, matcher, line, column);
    if (found.kind === 'no-source') return { targets: [], noCode: false };
    if (found.kind === 'no-code') return { targets: [], noCode: true };
    const key = mapKey(script);
    return {
      noCode: false,
      targets: found.positions.map((position) => ({
        url: script.url,
        line: position.line,
        column: position.column,
        source: displayUrl(position.source),
        mapKey: key,
      })),
    };
  }

  /**
   * Where scripts' maps put an original place: maps already read first, and
   * when one names the file the others are not fetched.
   *
   * @param scripts - Loaded scripts
   * @param matcher - Matches the sources the file names
   * @param line - 1-based original line
   * @param column - 1-based original column, when given
   * @returns Targets, whether a source has no code at the line, and the maps that failed
   */
  async resolve(
    scripts: MappedScript[],
    matcher: RegExp,
    line: number,
    column?: number
  ): Promise<MapResolution> {
    const withMap = scripts.filter(
      (script): script is ScriptWithMap => script.sourceMapURL !== undefined
    );
    const unique = [...new Map(withMap.map((script) => [mapKey(script), script])).values()];
    const read = unique.filter((script) => this.loaded.has(mapKey(script)));
    const first = await this.lookupAll(read, matcher, line, column);
    if (first.targets.length > 0 || first.noCode) return first;
    const rest = unique.filter((script) => !read.includes(script));
    const second = await this.lookupAll(rest, matcher, line, column);
    return {
      targets: second.targets,
      noCode: second.noCode,
      failures: [...first.failures, ...second.failures],
    };
  }

  private async lookupAll(
    scripts: ScriptWithMap[],
    matcher: RegExp,
    line: number,
    column?: number
  ): Promise<MapResolution> {
    const results = await Promise.all(
      scripts.map(async (script) => {
        try {
          return this.targetsIn(await this.index(script), script, matcher, line, column);
        } catch (error) {
          return { targets: [], noCode: false, failure: getErrorMessage(error) };
        }
      })
    );
    return {
      targets: results.flatMap((result) => result.targets),
      noCode: results.some((result) => result.noCode),
      failures: [
        ...new Set(results.flatMap((result) => ('failure' in result ? [result.failure] : []))),
      ],
    };
  }

  private remember(key: string, size: number): void {
    this.sizes.set(key, size);
    this.total += size;
    for (const oldest of this.loaded.keys()) {
      if (this.total <= CACHE_BUDGET) return;
      if (oldest === key) continue;
      this.total -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
      this.loaded.delete(oldest);
    }
  }
}
