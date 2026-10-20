/**
 * `network list` with a request still pending (#861): its elapsed time ranks
 * it in `--sort duration`, matches `duration:` filters and shows in the row.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectRequests, usesElapsedTime, withElapsedTime } from '@/commands/network/listScope.js';
import { applyFilters, validateFilterString } from '@/telemetry/filterDsl.js';
import type { NetworkRequest } from '@/types.js';
import { formatNetworkList } from '@/ui/formatters/networkList.js';

const NOW = 1_000_000;

function request(requestId: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId,
    url: `https://a.test/${requestId}`,
    method: 'GET',
    timestamp: NOW - 100,
    status: 200,
    duration: 50,
    ...overrides,
  };
}

const slowFinished = request('css', { duration: 4500 });
const fast = request('js', { duration: 8 });
const failed = request('dns', { status: 0, duration: 3 });
const pending = request('xhr', { timestamp: NOW - 25_000 });
const { status: _status, duration: _duration, ...pendingFields } = pending;
const unfinished: NetworkRequest = pendingFields;

const ids = (requests: NetworkRequest[]): string[] => requests.map((r) => r.requestId);

function filtered(filter: string, requests: NetworkRequest[]): string[] {
  const validation = validateFilterString(filter);
  assert.ok(validation.valid);
  return ids(applyFilters(requests, validation.filters));
}

void describe('withElapsedTime', () => {
  void it('marks only unfinished requests, with the time since they started', () => {
    const [css, xhr, dns] = withElapsedTime([slowFinished, unfinished, failed], NOW);
    assert.deepEqual(css, slowFinished);
    assert.deepEqual(dns, failed);
    assert.equal(xhr?.pending, true);
    assert.equal(xhr?.elapsedMs, 25_000);
    assert.equal(xhr?.duration, undefined);
  });
});

void describe('usesElapsedTime', () => {
  void it('is true for --sort duration and any duration: filter, false otherwise', () => {
    assert.equal(usesElapsedTime('', 'duration'), true);
    assert.equal(usesElapsedTime('duration:>=1s', undefined), true);
    assert.equal(usesElapsedTime('status-code:>=400 !duration:<1s', undefined), true);
    assert.equal(usesElapsedTime('', 'size'), false);
    assert.equal(usesElapsedTime('domain:a.test', 'start'), false);
    assert.equal(usesElapsedTime('url:duration', undefined), false);
  });
});

void describe('--sort duration with a pending request', () => {
  const marked = withElapsedTime([slowFinished, fast, unfinished], NOW);

  void it('ranks it by its elapsed time among finished requests', () => {
    assert.deepEqual(ids(selectRequests(marked, 'duration', 0)), ['xhr', 'css', 'js']);
  });

  void it('keeps it in --last n ahead of a shorter finished request', () => {
    assert.deepEqual(ids(selectRequests(marked, 'duration', 2)), ['xhr', 'css']);
  });

  void it('keeps pending requests last for --sort size', () => {
    const sized = withElapsedTime(
      [{ ...slowFinished, encodedDataLength: 10 }, unfinished, { ...fast, encodedDataLength: 5 }],
      NOW
    );
    assert.deepEqual(ids(selectRequests(sized, 'size', 0)), ['css', 'js', 'xhr']);
  });
});

void describe('duration: filter with a pending request', () => {
  const marked = withElapsedTime([slowFinished, fast, unfinished, failed], NOW);

  void it('matches a lower bound by the elapsed time (the slow preset)', () => {
    assert.deepEqual(filtered('duration:>=1s', marked), ['css', 'xhr']);
    assert.deepEqual(filtered('duration:>30s', marked), []);
  });

  void it('never matches an upper bound: it is still running', () => {
    assert.deepEqual(filtered('duration:<=10s', marked), ['css', 'js', 'dns']);
  });

  void it('leaves a request without elapsed time out, as before', () => {
    assert.deepEqual(filtered('duration:>=1s', [slowFinished, unfinished]), ['css']);
  });
});

void describe('row of a pending request', () => {
  void it('shows the elapsed time with a marker next to PND, and no marker on finished rows', () => {
    const marked = withElapsedTime([slowFinished, unfinished], NOW);
    const lines = formatNetworkList(selectRequests(marked, 'duration', 0), {
      sort: 'duration',
      totalCount: 2,
    }).split('\n');
    const xhr = lines.find((line) => line.includes('/xhr')) ?? '';
    const css = lines.find((line) => line.includes('/css')) ?? '';
    assert.match(xhr, /PND .*≥25\.0s {2}/);
    assert.match(css, / 4\.5s {2}/);
    assert.doesNotMatch(css, /≥/);
  });

  void it('is unchanged without elapsed time', () => {
    const text = formatNetworkList([unfinished], { totalCount: 1 });
    assert.match(text, /PND .* - {2}/);
    assert.doesNotMatch(text, /≥/);
  });
});
