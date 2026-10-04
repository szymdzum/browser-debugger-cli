/**
 * Network details formatter: WebSocket messages.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatNetworkDetails } from '@/ui/formatters/details.js';

void describe('formatNetworkDetails', () => {
  void it('lists WebSocket messages with direction, binary sizes and truncation', () => {
    const output = formatNetworkDetails({
      requestId: 'W',
      url: 'ws://example.com/ws',
      method: 'GET',
      timestamp: 0,
      status: 101,
      resourceType: 'WebSocket',
      webSocket: {
        frames: [
          { timestamp: 0, direction: 'sent', opcode: 1, payloadData: 'hello\nworld' },
          { timestamp: 0, direction: 'received', opcode: 2, payloadData: 'AQID' },
          {
            timestamp: 0,
            direction: 'received',
            opcode: 1,
            payloadData: 'x'.repeat(10),
            truncatedFrom: 500,
          },
        ],
      },
    });

    assert.match(output, /WebSocket Messages \(3, open\)/);
    assert.match(output, /↑ 00:00:00\.000 {2}hello world/);
    assert.match(output, /↓ 00:00:00\.000 {2}\(binary, 3 bytes captured\)/);
    assert.match(output, /x{10} \[truncated\]/);
  });

  void it('shows when a WebSocket closed', () => {
    const output = formatNetworkDetails({
      requestId: 'W',
      url: 'ws://example.com/ws',
      method: 'GET',
      timestamp: 0,
      webSocket: { frames: [], closedTime: 1000 },
    });

    assert.match(output, /WebSocket Messages \(0, closed at 1970-01-01T00:00:01\.000Z\)/);
  });
});
