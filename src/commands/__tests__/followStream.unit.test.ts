/**
 * Follow modes stream each item once.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { messageKeys } from '@/commands/console.js';
import type { ConsoleMessage, NetworkRequest } from '@/types.js';
import { formatNetworkFollowRows } from '@/ui/formatters/networkList.js';
import { failureReason } from '@/ui/formatters/requestStatus.js';

void describe('console follow keys', () => {
  void it('tells apart identical messages logged in the same millisecond', () => {
    const message: ConsoleMessage = { type: 'log', text: 'x', timestamp: 1000 };
    const keys = messageKeys([message, { ...message }, { ...message, text: 'y' }]);
    assert.equal(new Set(keys).size, 3);
    assert.deepEqual(messageKeys([message]), keys.slice(0, 1));
  });
});

void describe('network follow rows', () => {
  const request: NetworkRequest = {
    requestId: '1.1',
    url: 'https://a.test/x',
    method: 'GET',
    timestamp: 0,
    status: 200,
    duration: 5,
  };

  void it('prints the column header only the first time', () => {
    assert.match(formatNetworkFollowRows([request], { header: true }), /STS METH/);
    assert.doesNotMatch(formatNetworkFollowRows([request]), /STS METH/);
  });
});

void describe('failureReason', () => {
  void it('hides a body abort after a complete response', () => {
    assert.equal(failureReason({ status: 204, errorText: 'net::ERR_ABORTED' }), undefined);
    assert.equal(failureReason({ status: 0, errorText: 'net::ERR_ABORTED' }), 'net::ERR_ABORTED');
  });
});
