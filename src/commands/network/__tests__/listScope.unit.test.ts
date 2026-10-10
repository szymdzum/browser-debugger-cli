/**
 * `network list --page` and `--sort`: which page's requests are listed, in
 * which order, and which `--last` window of them.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidArgumentError } from 'commander';

import {
  defaultPageScope,
  followConflict,
  pageScopeOption,
  scopeToPage,
  selectRequests,
  sortKeyOption,
} from '@/commands/network/listScope.js';
import type { NetworkRequest } from '@/types.js';

function request(requestId: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId,
    url: `https://a.test/${requestId}`,
    method: 'GET',
    timestamp: 0,
    ...overrides,
  };
}

const ids = (requests: NetworkRequest[]): string[] => requests.map((r) => r.requestId);

void describe('scopeToPage', () => {
  const requests = [
    request('old-404', { navigationId: 1 }),
    request('tab-before-switch', { navigationId: 2 }),
    request('doc', { navigationId: 3 }),
    request('untagged'),
  ];

  void it("keeps the current page's requests and counts the others", () => {
    const scoped = scopeToPage(requests, 'current', { all: requests, currentNavigationId: 3 });
    assert.deepEqual(ids(scoped.requests), ['doc', 'untagged']);
    assert.equal(scoped.hidden, 2);
  });

  void it('keeps everything with all', () => {
    const scoped = scopeToPage(requests, 'all', { all: requests, currentNavigationId: 3 });
    assert.equal(scoped.requests.length, 4);
    assert.equal(scoped.hidden, 0);
  });

  void it('falls back to the latest navigation among all captured requests', () => {
    assert.deepEqual(ids(scopeToPage(requests, 'current', { all: requests }).requests), [
      'doc',
      'untagged',
    ]);
  });

  void it('takes the fallback from all requests, not from the matches', () => {
    const matches = [request('old-404', { navigationId: 1 })];
    const scoped = scopeToPage(matches, 'current', { all: requests });
    assert.deepEqual(ids(scoped.requests), []);
    assert.equal(scoped.hidden, 1);
  });
});

void describe('defaultPageScope', () => {
  void it('is the current page for errors, failed and slow, all otherwise', () => {
    assert.equal(defaultPageScope('errors'), 'current');
    assert.equal(defaultPageScope('FAILED'), 'current');
    assert.equal(defaultPageScope('slow'), 'current');
    assert.equal(defaultPageScope('api'), 'all');
    assert.equal(defaultPageScope(undefined), 'all');
  });
});

void describe('selectRequests', () => {
  const requests = [
    request('a', { encodedDataLength: 10, duration: 300, sentTime: 3, timestamp: 3000 }),
    request('b', { encodedDataLength: 500, duration: 20, sentTime: 1, timestamp: 1000 }),
    request('pending', { sentTime: 4, timestamp: 4000 }),
    request('c', { encodedDataLength: 90, duration: 900, sentTime: 2, timestamp: 2000 }),
  ];

  void it('without --sort keeps capture order and the last n', () => {
    assert.deepEqual(ids(selectRequests(requests, undefined, 2)), ['pending', 'c']);
  });

  void it('--sort size lists the largest first; --last takes the largest n', () => {
    assert.deepEqual(ids(selectRequests(requests, 'size', 0)), ['b', 'c', 'a', 'pending']);
    assert.deepEqual(ids(selectRequests(requests, 'size', 2)), ['b', 'c']);
  });

  void it('--sort duration lists the slowest first, pending ones last', () => {
    assert.deepEqual(ids(selectRequests(requests, 'duration', 0)), ['c', 'a', 'b', 'pending']);
    assert.deepEqual(ids(selectRequests(requests, 'duration', 1)), ['c']);
  });

  void it('--sort start lists by start time; --last takes the latest n', () => {
    assert.deepEqual(ids(selectRequests(requests, 'start', 0)), ['b', 'c', 'a', 'pending']);
    assert.deepEqual(ids(selectRequests(requests, 'start', 2)), ['a', 'pending']);
  });
});

void describe('option parsers', () => {
  void it('accept the values in any case', () => {
    assert.equal(pageScopeOption('Current'), 'current');
    assert.equal(pageScopeOption('all'), 'all');
    assert.equal(sortKeyOption('SIZE'), 'size');
    assert.equal(sortKeyOption('duration'), 'duration');
    assert.equal(sortKeyOption('start'), 'start');
  });

  void it('reject other values with a did-you-mean', () => {
    assert.throws(
      () => pageScopeOption('curent'),
      (error: unknown) =>
        error instanceof InvalidArgumentError && /did you mean current\?/.test(error.message)
    );
    assert.throws(
      () => sortKeyOption('sise'),
      (error: unknown) =>
        error instanceof InvalidArgumentError && /did you mean size\?/.test(error.message)
    );
    assert.throws(
      () => sortKeyOption('xyzzy'),
      (error: unknown) =>
        error instanceof InvalidArgumentError && /size, duration or start/.test(error.message)
    );
  });
});

void describe('followConflict', () => {
  void it('rejects --page and --sort with --follow', () => {
    assert.match(
      followConflict({ follow: true, page: 'current' })?.message ?? '',
      /--page cannot be combined with --follow/
    );
    assert.match(followConflict({ follow: true, page: 'all' })?.message ?? '', /--page/);
    assert.match(
      followConflict({ follow: true, sort: 'size' })?.message ?? '',
      /--sort cannot be combined with --follow/
    );
  });

  void it('accepts them without --follow, and --follow alone (a preset too)', () => {
    assert.equal(followConflict({ page: 'current', sort: 'size' }), undefined);
    assert.equal(followConflict({ follow: true }), undefined);
  });
});
