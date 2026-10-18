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

/** How long one `debug log` waits for maps in all; slower ones bind later */
const LOOKUP_BUDGET_MS = 5000;

/** A script Chrome parsed, as far as maps are concerned */
export interface MappedScript {
  url: string;
  sourceMapURL?: string;
  /** Content hash Chrome gives the script: a rebuilt bundle keeps its URL, not its hash */
  hash?: string;
}

/** A script that points at a map */
export type ScriptWithMap = MappedScript & { sourceMapURL: string };

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
  /** Other generated places of the same original line, to try when this one is shared with another statement */
  alternatives?: Array<{ line: number; column: number; ownsReturnSlot: boolean }>;
  /** A `return` break location at `line:column` is this original line's own, not the end of another statement */
  ownsReturnSlot?: boolean;
}

/** What asking the maps found */
export interface MapResolution {
  targets: BreakpointTarget[];
  /** A source the file names has no code at the line */
  noCode: boolean;
  /** Why maps could not be used, one per map */
  failures: string[];
  /** Maps that had not answered when the lookup stopped waiting */
  unread: ScriptWithMap[];
}

/** Options of {@link SourceMapReader} (tests shrink them) */
export interface ReaderOptions {
  /** How long one map may take to arrive */
  timeoutMs?: number;
  /** Largest map read (bytes) */
  maxBytes?: number;
  /** Length of `mappings` text the cached indexes may add up to */
  cacheBudget?: number;
  /** How long one lookup waits for maps in all */
  lookupMs?: number;
}

/**
 * Identity of a script's map: the script, its content hash and its map URL
 * (an inline map stands for its hash, not its megabytes).
 *
 * @param script - Script with a map
 * @returns Key
 */
export function mapKey(script: ScriptWithMap): string {
  const map = script.sourceMapURL.startsWith('data:')
    ? `data:${createHash('sha1').update(script.sourceMapURL).digest('hex')}`
    : script.sourceMapURL;
  return `${script.url}\n${map}\n${script.hash ?? ''}`;
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
 * @param timeoutMs - The timeout that applied
 * @returns Reason
 */
function fetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer in ${timeoutMs / 1000}s`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  return getErrorMessage(cause ?? error);
}

/**
 * The text of a response, read as it arrives and given up on past a size.
 *
 * @param response - Response with a body
 * @param maxBytes - Most bytes read
 * @returns Text
 * @throws SourceMapError past `maxBytes` (the body is cancelled, not buffered)
 */
export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const tooBig = new SourceMapError(`the map is over ${Math.round(maxBytes / (1024 * 1024))} MB`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooBig;
  }
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBig;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Fetch an external map.
 *
 * @param url - Absolute URL
 * @param options - Timeout and size limit
 * @returns Text
 * @throws SourceMapError for a failed, refused or oversized answer
 */
async function fetchMapText(
  url: URL,
  options: { timeoutMs: number; maxBytes: number }
): Promise<string> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SourceMapError(`${url.protocol} maps are not fetched`);
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
    if (!response.ok) throw new SourceMapError(`HTTP ${response.status}`);
    return await readLimitedText(response, options.maxBytes);
  } catch (error) {
    throw error instanceof SourceMapError
      ? error
      : new SourceMapError(fetchFailure(error, options.timeoutMs));
  }
}

/**
 * Read and index the map a script points at.
 *
 * @param script - Script with a map
 * @returns The indexed map
 * @throws SourceMapError with the reason, naming the map
 */
async function loadIndex(
  script: ScriptWithMap,
  limits: { timeoutMs: number; maxBytes: number }
): Promise<SourceMapIndex> {
  const inline = script.sourceMapURL.startsWith('data:');
  let name = inline ? `inline map of ${displayUrl(script.url)}` : displayUrl(script.sourceMapURL);
  try {
    if (inline) {
      return indexSourceMap(parseSourceMap(dataUrlText(script.sourceMapURL)), script.url);
    }
    const url = new URL(script.sourceMapURL, script.url);
    name = displayUrl(url.href);
    return indexSourceMap(parseSourceMap(await fetchMapText(url, limits)), url.href);
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
  private generation = 0;
  private readonly limiter = new ConcurrencyLimiter(FETCH_CONCURRENCY);
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly cacheBudget: number;
  private readonly lookupMs: number;

  /**
   * @param options - Limits (defaults: 5 s a map, 50 MB, 16M characters cached, 5 s a lookup)
   */
  constructor(options: ReaderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? MAX_MAP_BYTES;
    this.cacheBudget = options.cacheBudget ?? CACHE_BUDGET;
    this.lookupMs = options.lookupMs ?? LOOKUP_BUDGET_MS;
  }

  /** Forget what was read (a page load starts over; a rebuilt map is read again) */
  clear(): void {
    this.generation++;
    this.loaded.clear();
    this.sizes.clear();
    this.total = 0;
  }

  /** How many indexes are kept, and the length of mappings they add up to */
  get cached(): { count: number; size: number } {
    return { count: this.sizes.size, size: this.total };
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
    const known = this.loaded.get(key);
    if (known) return known;
    const generation = this.generation;
    const loaded = this.limiter.run(() =>
      loadIndex(script, { timeoutMs: this.timeoutMs, maxBytes: this.maxBytes })
    );
    this.loaded.set(key, loaded);
    loaded.then(
      (index) => {
        if (this.loaded.get(key) === loaded && generation === this.generation) {
          this.remember(key, index.size);
        }
      },
      () => {
        if (this.loaded.get(key) === loaded) this.loaded.delete(key);
      }
    );
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
        alternatives: position.alternatives,
        ownsReturnSlot: position.ownsReturnSlot,
      })),
    };
  }

  /**
   * Where scripts' maps put an original place: maps already read first; as
   * soon as one names the file the others are left (they go on loading and
   * are reported as `unread`); the lookup waits for maps no longer than one
   * budget in all.
   *
   * @param scripts - Loaded scripts
   * @param matcher - Matches the sources the file names
   * @param line - 1-based original line
   * @param column - 1-based original column, when given
   * @returns Targets, whether a source has no code at the line, the maps that failed and those still loading
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
    const deadline = Date.now() + this.lookupMs;
    const first = await this.lookupWithin(read, matcher, line, column, deadline);
    if (first.targets.length > 0 || first.noCode) return first;
    const rest = unique.filter((script) => !read.includes(script));
    const second = await this.lookupWithin(rest, matcher, line, column, deadline);
    return {
      targets: second.targets,
      noCode: second.noCode,
      failures: [...first.failures, ...second.failures],
      unread: [...first.unread, ...second.unread],
    };
  }

  private lookupWithin(
    scripts: ScriptWithMap[],
    matcher: RegExp,
    line: number,
    column: number | undefined,
    deadline: number
  ): Promise<MapResolution> {
    return new Promise((resolve) => {
      const found: MapResolution = { targets: [], noCode: false, failures: [], unread: [] };
      const waiting = new Set(scripts);
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        found.failures = [...new Set(found.failures)];
        found.unread = [...waiting];
        resolve(found);
      };
      const timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
      if (waiting.size === 0) finish();
      for (const script of scripts) {
        this.index(script).then(
          (index) => {
            if (finished) return;
            waiting.delete(script);
            const result = this.targetsIn(index, script, matcher, line, column);
            found.targets.push(...result.targets);
            found.noCode ||= result.noCode;
            if (result.targets.length > 0 || result.noCode || waiting.size === 0) finish();
          },
          (error: unknown) => {
            if (finished) return;
            waiting.delete(script);
            found.failures.push(getErrorMessage(error));
            if (waiting.size === 0) finish();
          }
        );
      }
    });
  }

  private remember(key: string, size: number): void {
    if (size > this.cacheBudget) {
      this.loaded.delete(key);
      return;
    }
    this.sizes.set(key, size);
    this.total += size;
    for (const oldest of this.loaded.keys()) {
      if (this.total <= this.cacheBudget) return;
      if (oldest === key) continue;
      this.total -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
      this.loaded.delete(oldest);
    }
  }
}
