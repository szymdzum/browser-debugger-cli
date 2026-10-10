/**
 * Session status for an external Chrome (`--chrome-ws-url`), which has no PID.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionMetadata } from '@/session/metadata.js';
import { formatNetworkHeaders } from '@/ui/formatters/networkHeaders.js';
import {
  formatNoSessionMessage,
  formatSessionStatus,
  formatStatusAsJson,
} from '@/ui/formatters/status.js';

const external: SessionMetadata = {
  bdgPid: process.pid,
  chromePid: 0,
  startTime: Date.now(),
  port: 9333,
};

void describe('status of an external Chrome', () => {
  void it('marks the Chrome as external instead of not running', () => {
    const json = formatStatusAsJson(external, process.pid);

    assert.equal(json.externalChrome, true);
    assert.equal(json.chromeAlive, undefined);
    assert.equal(json.port, 9333);
  });

  void it('says so in the human output', () => {
    const output = formatSessionStatus(external, process.pid);

    assert.match(output, /Chrome:\s+external \(not launched by bdg\)/);
    assert.doesNotMatch(output, /not running/);
  });

  void it('still reports a launched Chrome by PID', () => {
    const json = formatStatusAsJson({ ...external, chromePid: process.pid }, process.pid);

    assert.equal(json.chromeAlive, true);
    assert.equal(json.externalChrome, undefined);
  });
});

void describe('status activity at the capture limits', () => {
  void it('says how many requests were dropped under the network count', () => {
    const activity = {
      networkRequestsCaptured: 10000,
      consoleMessagesCaptured: 0,
      networkRequestsDropped: 2000,
    };
    const output = formatSessionStatus(external, process.pid, activity);

    assert.match(
      output,
      /Network Requests:\s+10000 captured\n\s+⚠ 2000 older network requests were dropped: bdg keeps the newest 10000/
    );
  });
});

void describe('formatNoSessionMessage', () => {
  void it('shows a start in progress instead of "no session"', () => {
    const text = formatNoSessionMessage({
      active: false,
      starting: { url: 'http://example.com/', since: Date.now() - 3000 },
    });
    assert.match(text, /Session starting: http:\/\/example\.com\/ \(3s so far\)/);
    assert.doesNotMatch(text, /No active session/);
  });

  void it('mentions a Chrome left running by an earlier session', () => {
    const text = formatNoSessionMessage({ active: false, orphanedChromePid: 4321 });
    assert.match(text, /still running \(PID 4321\)/);
    assert.match(text, /bdg cleanup/);
  });
});

void describe('status first line', () => {
  void it('starts with the session and its page on one line', () => {
    const page = { url: 'https://example.com/', title: 'Example Domain' };
    const output = formatSessionStatus(external, process.pid, undefined, page);
    assert.equal(output.split('\n')[0], 'Session active: https://example.com/ — Example Domain');
    assert.match(output, /Session Status/);
    assert.equal(
      formatSessionStatus(external, process.pid, undefined, { ...page, title: '' }).split('\n')[0],
      'Session active: https://example.com/'
    );
    assert.equal(formatSessionStatus(external, process.pid).split('\n')[0], 'Session active');
  });
});

void describe('network headers', () => {
  const data = {
    url: 'https://example.com/missing',
    requestId: '42.1',
    requestHeaders: {},
    responseHeaders: { 'content-type': 'text/html' },
  };

  void it('shows the method and status line', () => {
    const output = formatNetworkHeaders({
      ...data,
      method: 'GET',
      status: 404,
      statusText: 'Not Found',
    });
    assert.match(output, /^Status: GET 404 Not Found$/m);
  });

  void it('says how a request failed, or that it is pending', () => {
    assert.match(
      formatNetworkHeaders({ ...data, method: 'GET', status: 0, errorText: 'net::ERR_FAILED' }),
      /^Status: GET FAILED \(net::ERR_FAILED\)$/m
    );
    assert.match(formatNetworkHeaders({ ...data, method: 'POST' }), /^Status: POST pending$/m);
  });
});

void describe('status of the --dialog session default (#553)', () => {
  void it('shows a dismiss default as a line and in JSON', () => {
    const metadata: SessionMetadata = { ...external, dialog: 'dismiss' };
    assert.equal(formatStatusAsJson(metadata, process.pid).dialog, 'dismiss');
    assert.match(
      formatSessionStatus(metadata, process.pid),
      /Dialogs:\s+dismiss \(session default\)/
    );
  });

  void it('leaves out the built-in accept', () => {
    const metadata: SessionMetadata = { ...external, dialog: 'accept' };
    assert.equal(formatStatusAsJson(metadata, process.pid).dialog, undefined);
    assert.doesNotMatch(formatSessionStatus(metadata, process.pid), /Dialogs:/);
    assert.doesNotMatch(formatSessionStatus(external, process.pid), /Dialogs:/);
  });
});
