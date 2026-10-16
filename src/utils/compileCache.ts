/**
 * Node's module compile cache: keeps the compiled code of the bundles in the
 * OS temp dir, so the next start skips parsing ~1 MB of JavaScript (#661).
 */

import * as nodeModule from 'node:module';

import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('bdg');

/**
 * Turn on Node's compile cache for the modules loaded after this call. Only
 * the CLI entry calls it: it loads `dist/cli.js` afterwards. The daemon is one
 * bundle that loads nothing after its start, so a call there caches nothing. Node
 * itself honours `NODE_COMPILE_CACHE` (cache directory) and
 * `NODE_DISABLE_COMPILE_CACHE` (off). A runtime without the API (Node < 22.1),
 * an unwritable cache directory or any error is ignored: the cache is only
 * an optimisation and never changes what bdg prints.
 */
export function enableBdgCompileCache(): void {
  if (typeof nodeModule.enableCompileCache !== 'function') {
    log.debug('Compile cache unavailable on this Node');
    return;
  }
  try {
    const result = nodeModule.enableCompileCache();
    log.debug(
      `Compile cache status ${result.status}${result.message ? `: ${result.message}` : ''}`
    );
  } catch (error) {
    log.debug(`Compile cache not enabled: ${getErrorMessage(error)}`);
  }
}
