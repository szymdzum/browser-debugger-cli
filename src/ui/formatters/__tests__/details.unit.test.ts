/**
 * Network details formatter: WebSocket messages.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatConsoleDetails, formatNetworkDetails } from '@/ui/formatters/details.js';

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
    assert.match(output, /↑ \d{2}:\d{2}:\d{2}\.\d{3} {2}hello world/);
    assert.match(output, /↓ \d{2}:\d{2}:\d{2}\.\d{3} {2}\(binary, 3 bytes captured\)/);
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

  void it('summarizes timing and size, and explains bodies that were not captured', () => {
    const output = formatNetworkDetails({
      requestId: 'R',
      url: 'https://example.com/logo.png',
      method: 'GET',
      timestamp: 0,
      status: 200,
      duration: 42,
      encodedDataLength: 2048,
      bodyNotCaptured: 'images are skipped (use --all)',
    });

    assert.match(output, /Duration:\s+42 ms/);
    assert.match(output, /Size:\s+2\.0 KB transferred/);
    assert.match(output, /\(not captured: images are skipped \(use --all\)\)/);
  });

  void it('cuts very long text bodies and points to the JSON output', () => {
    const output = formatNetworkDetails({
      requestId: 'R',
      url: 'https://example.com/app.js',
      method: 'GET',
      timestamp: 0,
      status: 200,
      responseBody: 'x'.repeat(30000),
    });

    assert.match(output, /10000 more characters \(full body: bdg details network R --json\)/);
  });
});

void describe('formatConsoleDetails', () => {
  void it('shows where the message came from', () => {
    const output = formatConsoleDetails({
      type: 'error',
      text: 'boom',
      timestamp: 0,
      stackTrace: [
        { url: 'https://example.com/app.js', lineNumber: 9, columnNumber: 4, functionName: 'init' },
      ],
    });

    assert.match(output, /at init \(https:\/\/example\.com\/app\.js:10:5\)/);
  });
});
