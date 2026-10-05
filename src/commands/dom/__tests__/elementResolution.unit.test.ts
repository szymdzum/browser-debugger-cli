/**
 * Index arguments without a session, and stale-element errors naming the
 * index the user gave.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import type { QueryCacheManager, QueryCacheValidation } from '@/session/QueryCacheManager.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-resolve-'));
const savedSessionDir = process.env['BDG_SESSION_DIR'];

before(() => {
  process.env['BDG_SESSION_DIR'] = sessionDir;
});
after(() => {
  if (savedSessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
  else process.env['BDG_SESSION_DIR'] = savedSessionDir;
  fs.rmSync(sessionDir, { recursive: true, force: true });
});
afterEach(() => DomElementResolver.resetInstance());

/**
 * Cache manager stub answering with a fixed validation.
 *
 * @param validation - What `validate()` returns
 * @returns Stub usable as a QueryCacheManager
 */
function cacheReturning(validation: QueryCacheValidation): QueryCacheManager {
  return { validate: () => Promise.resolve(validation) } as unknown as QueryCacheManager;
}

void describe('DomElementResolver without a session', () => {
  void it('reports "No active session" (83) for an index, not a missing query cache', async () => {
    const resolver = new DomElementResolver(
      cacheReturning({ valid: false, cache: null, error: 'No cached query results found' })
    );

    const result = await resolver.resolve('0', undefined, 'click');

    assert.equal(result.success, false);
    assert.equal(!result.success && result.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(!result.success ? result.error : '', /No active session/);
  });
});

void describe('runElementCommand', () => {
  void it('names the index when the daemon reports the element as stale', async () => {
    const cache = {
      selector: 'p',
      nodes: [{ index: 0, nodeId: 42, tag: 'p' }],
    } as unknown as QueryCacheValidation['cache'];
    Reflect.set(
      DomElementResolver,
      'instance',
      new DomElementResolver(cacheReturning({ valid: true, cache }))
    );

    const result = await runElementCommand({
      selectorOrIndex: '0',
      index: undefined,
      buildRequest: (target) => target,
      call: () =>
        Promise.resolve({
          status: 'error',
          error: 'The element is no longer in the page',
          exitCode: EXIT_CODES.STALE_CACHE,
        }),
      command: 'click',
      action: 'click element',
      failureSuggestion: '',
    });

    assert.equal(result.exitCode, EXIT_CODES.STALE_CACHE);
    assert.match(result.error ?? '', /element at index 0 is no longer in the page/);
  });
});

void describe('DomElementResolver with --index', () => {
  void it('refuses --index together with a numeric index (81)', async () => {
    const resolver = new DomElementResolver(cacheReturning({ valid: false, cache: null }));
    const result = await resolver.resolve('1', 3, 'layout');
    assert.equal(result.success, false);
    assert.equal(!result.success && result.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(!result.success ? result.error : '', /already an index/);
    assert.match(!result.success ? (result.suggestion ?? '') : '', /bdg dom layout 1,/);
  });
});
