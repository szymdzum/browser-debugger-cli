/**
 * Network details formatter: WebSocket messages, remote address, repeated headers.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NetworkRequest } from '@/types.js';
import {
  formatConsoleDetails,
  formatNetworkDetails,
  remoteAddress,
} from '@/ui/formatters/details.js';
import { headerValueLines } from '@/ui/formatters/networkHeaders.js';

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
            opcode: 2,
            payloadData: Buffer.from('{"op":"ping"}').toString('base64'),
          },
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

    assert.match(output, /WebSocket Messages \(4, open\)/);
    assert.match(output, /↑ \d{2}:\d{2}:\d{2}\.\d{3} {2}hello world/);
    assert.match(output, /↓ \d{2}:\d{2}:\d{2}\.\d{3} {2}\(binary, 3 bytes captured\)/);
    assert.match(output, /\(binary, 13 bytes\) \{"op":"ping"\}/);
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

void describe('remoteAddress', () => {
  const request = (url: string, serverIPAddress: string, serverPort?: number): NetworkRequest => ({
    requestId: '1',
    url,
    method: 'GET',
    timestamp: 0,
    serverIPAddress,
    ...(serverPort !== undefined && { serverPort }),
  });

  void it('adds the port', () => {
    assert.equal(
      remoteAddress(request('https://a.test/', '93.184.215.14', 443)),
      '93.184.215.14:443'
    );
    assert.equal(
      remoteAddress(request('https://a.test/', '2606:4700::1', 443)),
      '[2606:4700::1]:443'
    );
    assert.equal(
      remoteAddress(request('https://a.test/', '[2606:4700::1]', 443)),
      '[2606:4700::1]:443'
    );
    assert.equal(remoteAddress(request('https://a.test/', '93.184.215.14')), '93.184.215.14');
  });

  void it('labels a loopback address of a request to another host as a local proxy', () => {
    assert.equal(
      remoteAddress(request('https://www.saucedemo.com/', '127.0.0.1', 9000)),
      '127.0.0.1:9000 (local proxy)'
    );
    assert.equal(
      remoteAddress(request('https://a.test/', '[::1]', 8080)),
      '[::1]:8080 (local proxy)'
    );
  });

  void it('does not label requests to this machine', () => {
    assert.equal(
      remoteAddress(request('http://localhost:3000/', '127.0.0.1', 3000)),
      '127.0.0.1:3000'
    );
    assert.equal(
      remoteAddress(request('http://127.0.0.1:8080/', '127.0.0.1', 8080)),
      '127.0.0.1:8080'
    );
    assert.equal(remoteAddress(request('http://app.localhost/', '::1', 80)), '[::1]:80');
  });

  void it('shows in the details', () => {
    const output = formatNetworkDetails(request('https://www.saucedemo.com/', '127.0.0.1', 9000));
    assert.match(output, /Remote Address: 127\.0\.0\.1:9000 \(local proxy\)/);
  });
});

void describe('repeated headers', () => {
  void it('lists each value once, saying how often it was sent', () => {
    assert.deepEqual(headerValueLines('max-age=63072000\nmax-age=63072000'), [
      'max-age=63072000 (sent 2 times)',
    ]);
    assert.deepEqual(headerValueLines('a=1\nb=2\na=1'), ['a=1 (sent 2 times)', 'b=2']);
    assert.deepEqual(headerValueLines('max-age=600'), ['max-age=600']);
  });

  void it('prints one line per value in the details', () => {
    const output = formatNetworkDetails({
      requestId: '1',
      url: 'https://events.test/',
      method: 'OPTIONS',
      timestamp: 0,
      responseHeaders: {
        'Strict-Transport-Security': 'max-age=63072000\nmax-age=63072000',
        'Set-Cookie': 'a=1\nb=2',
      },
    });
    assert.match(output, /^ {2}Strict-Transport-Security: max-age=63072000 \(sent 2 times\)$/m);
    assert.match(output, /^ {2}Set-Cookie: a=1$/m);
    assert.match(output, /^ {2}Set-Cookie: b=2$/m);
    assert.doesNotMatch(output, /^max-age/m);
  });
});
