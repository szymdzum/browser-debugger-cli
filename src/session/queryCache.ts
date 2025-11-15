import fs from 'fs';

import { getDomQueryCachePath } from '@/session/paths.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { domCacheWriteWarning } from '@/ui/messages/internal.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

/**
 * DOM query cache structure
 * Stores results from last DOM query for index-based lookups
 */
export interface DomQueryCache {
  selector: string;
  timestamp: string;
  sessionId?: string;
  nodes: Array<{
    index: number;
    nodeId: number;
    tag?: string;
    classes?: string[];
    preview?: string;
  }>;
}

/**
 * Cache expiration time (5 minutes)
 */
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Write DOM query results to cache
 *
 * Uses AtomicFileWriter to prevent corruption from concurrent writes or
 * crashes during write operations.
 *
 * @param cache - DOM query cache data to write
 */
export function writeQueryCache(cache: DomQueryCache): void {
  try {
    const cachePath = getDomQueryCachePath();
    AtomicFileWriter.writeSync(cachePath, JSON.stringify(cache, null, 2), { encoding: 'utf8' });
  } catch (error) {
    // Silently fail - cache is optional and non-critical for CLI operation
    console.error(domCacheWriteWarning(getErrorMessage(error)));
  }
}

/**
 * Read DOM query cache
 *
 * @returns DOM query cache or null if not available/expired
 */
export function readQueryCache(): DomQueryCache | null {
  try {
    const cachePath = getDomQueryCachePath();

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const data = fs.readFileSync(cachePath, 'utf8');
    const cache = JSON.parse(data) as DomQueryCache;

    // Check if cache is expired
    const cacheTime = new Date(cache.timestamp).getTime();
    const now = Date.now();

    if (now - cacheTime > CACHE_EXPIRY_MS) {
      // Cache expired - delete it
      fs.unlinkSync(cachePath);
      return null;
    }

    return cache;
  } catch {
    // Silently fail - cache is optional, missing/corrupt cache doesn't affect core functionality
    return null;
  }
}

/**
 * Get nodeId from cache by index
 *
 * @param index - Index from query results (1-based)
 * @returns nodeId if found, null otherwise
 */
export function getNodeIdByIndex(index: number): number | null {
  const cache = readQueryCache();
  if (!cache) {
    return null;
  }

  const node = cache.nodes.find((n) => n.index === index);
  return node?.nodeId ?? null;
}
