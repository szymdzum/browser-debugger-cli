/**
 * Source maps for logpoints (#848, part 2): fetching a script's map (external,
 * from the daemon with a plain `fetch`, or inline `data:`), keeping what was
 * read per page load, and asking every loaded script's map where an original
 * `file:line[:col]` is in the generated code.
 */

import { getErrorMessage } from '@/utils/errors.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import {
  lookupGenerated,
  parseSourceMap,
  SourceMapError,
  type SourceMap,
} from '@/utils/sourceMap.js';

/** How long one map may take to arrive */
const FETCH_TIMEOUT_MS = 5000;

/** Largest map read (bytes of text) */
const MAX_MAP_BYTES = 50 * 1024 * 1024;

/** Maps fetched at the same time */
const FETCH_CONCURRENCY = 6;

/** A script Chrome parsed, as far as maps are concerned */
export interface MappedScript {
  url: string;
  sourceMapURL?: string;
}

/** A map read, with the URL its sources are relative to */
interface LoadedMap {
  map: SourceMap;
  baseUrl: string;
}

/** A place in a generated script, 1-based */
export interface MappedPlace {
  scriptUrl: string;
  line: number;
  column: number;
  /** The map source that matched, as a URL */
  source: string;
}

/** What asking the maps found */
export interface MapResolution {
  places: MappedPlace[];
  /** A source the file names has no code at the line (the first such source) */
  noCode?: string;
  /** Why maps could not be used, one per map */
  failures: string[];
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
 * @param url - Absolute http(s) URL
 * @returns Text
 * @throws SourceMapError for a failed, refused or oversized answer
 */
async function fetchMapText(url: URL): Promise<string> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceMapError(`${url.protocol} maps are not fetched`);
  }
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    throw new SourceMapError(fetchFailure(error));
  }
  if (!response.ok) throw new SourceMapError(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_MAP_BYTES) throw new SourceMapError('the map is over 50 MB');
  return text;
}

/**
 * Read the map a script points at.
 *
 * @param script - Script with a `sourceMapURL`
 * @returns The parsed map and the URL its sources are relative to
 * @throws SourceMapError with the reason, naming the map
 */
async function loadMap(script: Required<MappedScript>): Promise<LoadedMap> {
  const inline = script.sourceMapURL.startsWith('data:');
  let name = inline ? `inline map of ${displayUrl(script.url)}` : script.sourceMapURL;
  try {
    if (inline) {
      return { map: parseSourceMap(dataUrlText(script.sourceMapURL)), baseUrl: script.url };
    }
    const url = new URL(script.sourceMapURL, script.url);
    name = displayUrl(url.href);
    return { map: parseSourceMap(await fetchMapText(url)), baseUrl: url.href };
  } catch (error) {
    throw new SourceMapError(`${name}: ${getErrorMessage(error)}`);
  }
}

/**
 * The maps of the page now loaded, read once each.
 */
export class SourceMapReader {
  private readonly loaded = new Map<string, Promise<LoadedMap>>();
  private readonly limiter = new ConcurrencyLimiter(FETCH_CONCURRENCY);

  /** Forget what was read (a page load starts over; a rebuilt map is read again) */
  clear(): void {
    this.loaded.clear();
  }

  /**
   * Where scripts' maps put an original place.
   *
   * @param scripts - Loaded scripts
   * @param file - File as typed
   * @param line - 1-based original line
   * @param column - 1-based original column, when given
   * @returns Places in generated scripts, a source without code, and the maps that failed
   */
  async resolve(
    scripts: MappedScript[],
    file: string,
    line: number,
    column?: number
  ): Promise<MapResolution> {
    const mapped = scripts.filter(
      (script): script is Required<MappedScript> => script.sourceMapURL !== undefined
    );
    const unique = [...new Map(mapped.map((s) => [`${s.url}\n${s.sourceMapURL}`, s])).values()];
    const results = await Promise.all(
      unique.map((script) => this.resolveScript(script, file, line, column))
    );
    return {
      places: results.flatMap((result) => result.places),
      ...(results.some((result) => result.noCode !== undefined) && {
        noCode: results.find((result) => result.noCode !== undefined)?.noCode ?? '',
      }),
      failures: [...new Set(results.flatMap((result) => (result.failure ? [result.failure] : [])))],
    };
  }

  /**
   * Where one script's map puts an original place.
   *
   * @param script - Script with a `sourceMapURL`
   * @param file - File as typed
   * @param line - 1-based original line
   * @param column - 1-based original column, when given
   * @returns Its places, a source without code, or why the map failed
   */
  async resolveScript(
    script: Required<MappedScript>,
    file: string,
    line: number,
    column?: number
  ): Promise<{ places: MappedPlace[]; noCode?: string; failure?: string }> {
    let loaded: LoadedMap;
    try {
      loaded = await this.read(script);
    } catch (error) {
      return { places: [], failure: getErrorMessage(error) };
    }
    const found = lookupGenerated(loaded.map, loaded.baseUrl, file, line, column);
    if (found.kind === 'no-source') return { places: [] };
    if (found.kind === 'no-code') return { places: [], noCode: found.source };
    return {
      places: found.positions.map((position) => ({
        scriptUrl: script.url,
        line: position.line,
        column: position.column,
        source: position.source,
      })),
    };
  }

  private read(script: Required<MappedScript>): Promise<LoadedMap> {
    const key = `${script.url}\n${script.sourceMapURL}`;
    let loaded = this.loaded.get(key);
    if (!loaded) {
      loaded = this.limiter.run(() => loadMap(script));
      this.loaded.set(key, loaded);
    }
    return loaded;
  }
}
