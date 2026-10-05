/**
 * Index arguments without a session, stale-element errors naming the index
 * the user gave, and the list (query, form, a11y query) an index refers to.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import {
  cachedIndexOutOfRangeError,
  indexSourceText,
  otherIndexSourceNote,
  staleNodeError,
} from '@/errors/messages.js';
import {
  indexSourceOf,
  type QueryCacheManager,
  type QueryCacheValidation,
} from '@/session/QueryCacheManager.js';
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

/**
 * Make the resolver read these cached results.
 *
 * @param cache - Cached query result
 */
function useCache(cache: Partial<NonNullable<QueryCacheValidation['cache']>>): void {
  Reflect.set(
    DomElementResolver,
    'instance',
    new DomElementResolver(
      cacheReturning({ valid: true, cache: cache as QueryCacheValidation['cache'] })
    )
  );
}

/** `dom click 0` without the IPC call */
const clickCommand = {
  selectorOrIndex: '0',
  index: undefined,
  buildRequest: (target: object) => target,
  command: 'click',
  action: 'click element',
  failureSuggestion: '',
};

void describe('runElementCommand', () => {
  void it('names the index when the daemon reports the element as stale', async () => {
    useCache({ selector: 'p', nodes: [{ index: 0, nodeId: 42, tag: 'p' }] });

    const result = await runElementCommand({
      ...clickCommand,
      call: () =>
        Promise.resolve({
          status: 'error',
          error: 'The element is no longer in the page',
          exitCode: EXIT_CODES.STALE_CACHE,
        }),
    });

    assert.equal(result.exitCode, EXIT_CODES.STALE_CACHE);
    assert.match(
      result.error ?? '',
      /element at index 0 of the last dom query "p" is no longer in the page/
    );
    assert.match(result.errorContext?.['suggestion'] as string, /Re-run "bdg dom query 'p'"/);
  });

  void it('names the list an index refers to in the result', async () => {
    useCache({ selector: 'a11y name:Accept all', nodes: [{ index: 0, nodeId: 7, tag: 'button' }] });

    const result = await runElementCommand({
      ...clickCommand,
      call: () => Promise.resolve({ status: 'ok', data: { success: true } }),
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.data?.indexSource, {
      index: 0,
      command: 'dom a11y query',
      query: 'name:Accept all',
    });
  });

  void it('says which list the index came from when fill hits an element of a query', async () => {
    useCache({ selector: 'h3', nodes: [{ index: 0, nodeId: 7, tag: 'h3', preview: 'Welcome' }] });

    const result = await runElementCommand({
      ...clickCommand,
      command: 'fill',
      call: () =>
        Promise.resolve({
          status: 'ok',
          data: {
            success: false,
            error: 'Element is not fillable',
            suggestion: 'Only input, textarea, select, and contenteditable elements can be filled',
            unsuitableElement: true,
          },
        }),
    });

    assert.equal(result.success, false);
    assert.match(
      result.errorContext?.['suggestion'] as string,
      /index 0 refers to the last dom query results \("h3": h3 "Welcome"\); run bdg dom form to target form fields by index$/
    );
  });

  void it('adds no note for an element of the form list', async () => {
    useCache({
      selector: 'form:auto-discovered',
      nodes: [{ index: 0, nodeId: 7, selector: '#x' }],
    });

    const result = await runElementCommand({
      ...clickCommand,
      command: 'fill',
      call: () =>
        Promise.resolve({
          status: 'ok',
          data: { success: false, error: 'Element is not fillable', unsuitableElement: true },
        }),
    });

    assert.doesNotMatch(result.errorContext?.['suggestion'] as string, /dom form/);
  });
});

void describe('index source messages', () => {
  void it('tells which command a cached list comes from', () => {
    assert.deepEqual(indexSourceOf(2, 'form:auto-discovered'), { index: 2, command: 'dom form' });
    assert.deepEqual(indexSourceOf(0, 'a11y role:button'), {
      index: 0,
      command: 'dom a11y query',
      query: 'role:button',
    });
    assert.deepEqual(indexSourceOf(1, 'h3'), { index: 1, command: 'dom query', query: 'h3' });
  });

  void it('names the index and its list', () => {
    assert.equal(
      indexSourceText({ index: 0, command: 'dom query', query: 'h3' }),
      'index 0 of the last dom query "h3"'
    );
    assert.equal(
      indexSourceText({ index: 3, command: 'dom form' }),
      'index 3 of the last dom form'
    );
  });

  void it('reports an index beyond the list with the command that refreshes it', () => {
    const err = cachedIndexOutOfRangeError(
      { index: 5, command: 'dom a11y query', query: 'name:Go' },
      2
    );
    assert.equal(
      err.message,
      'Index 5 is out of range for the last dom a11y query "name:Go" (2 results)'
    );
    assert.equal(
      err.suggestion,
      `Use an index between 0 and 1, or re-run "bdg dom a11y query 'name:Go'"`
    );
  });

  void it('keeps the generic stale message without a known list', () => {
    assert.match(staleNodeError(3).message, /^The element at index 3 is no longer in the page/);
  });

  void it('points from another list to dom form for form fields', () => {
    assert.equal(
      otherIndexSourceNote({ index: 0, command: 'dom a11y query', query: 'role:link' }),
      'index 0 refers to the last dom a11y query results ("role:link"); run bdg dom form to target form fields by index'
    );
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
