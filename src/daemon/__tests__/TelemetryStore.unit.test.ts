/**
 * Unit tests for TelemetryStore
 *
 * Tests the contract: accumulate telemetry data, build correct output structure.
 * Focus on: partial vs full output, timestamp calculation, conditional data inclusion.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import type { CDPTarget, ConsoleMessage, DOMData, NetworkRequest } from '@/types';
import { VERSION } from '@/utils/version.js';

void describe('TelemetryStore', () => {
  let store: TelemetryStore;

  beforeEach(() => {
    store = new TelemetryStore();
  });

  void describe('initialization', () => {
    void it('starts with empty data collections', () => {
      assert.equal(store.networkRequests.length, 0);
      assert.equal(store.consoleMessages.length, 0);
      assert.equal(store.navigationEvents.length, 0);
    });

    void it('initializes with null state', () => {
      assert.equal(store.domData, null);
      assert.equal(store.targetInfo, null);
      assert.equal(store.getCurrentNavigationId, null);
    });

    void it('sets session start time on creation', () => {
      const before = Date.now();
      const newStore = new TelemetryStore();
      const after = Date.now();

      assert.ok(newStore.sessionStartTime >= before);
      assert.ok(newStore.sessionStartTime <= after);
    });
  });

  void describe('data setters', () => {
    void it('sets target info', () => {
      const target: CDPTarget = {
        id: 'target-1',
        type: 'page',
        url: 'http://example.com',
        title: 'Example',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
      };
      store.setTargetInfo(target);

      assert.deepEqual(store.targetInfo, target);
    });

    void it('sets DOM data', () => {
      const domData: DOMData = {
        url: 'http://example.com',
        title: 'Example',
        outerHTML: '<html></html>',
      };
      store.setDomData(domData);

      assert.deepEqual(store.domData, domData);
    });

    void it('sets navigation resolver function', () => {
      const resolver = (): number => 42;
      store.setNavigationResolver(resolver);

      assert.equal(store.getCurrentNavigationId, resolver);
    });

    void it('resets session start time', () => {
      const original = store.sessionStartTime;

      // Wait a bit to ensure time difference
      const wait = new Promise((resolve) => setTimeout(resolve, 10));
      void wait.then(() => {
        store.resetSessionStart();
        assert.ok(store.sessionStartTime > original);
      });
    });
  });

  void describe('buildOutput - empty state', () => {
    void it('builds output with no data', () => {
      const output = store.buildOutput();

      assert.equal(output.version, VERSION);
      assert.equal(output.success, true);
      assert.equal(typeof output.timestamp, 'string');
      assert.equal(typeof output.duration, 'number');
      assert.deepEqual(output.target, { url: '', title: '' });
      assert.deepEqual(output.data, {});
    });

    void it('excludes empty network array from data', () => {
      const output = store.buildOutput();

      assert.equal(output.data.network, undefined);
    });

    void it('excludes empty console array from data', () => {
      const output = store.buildOutput();

      assert.equal(output.data.console, undefined);
    });

    void it('excludes null DOM data from data', () => {
      const output = store.buildOutput();

      assert.equal(output.data.dom, undefined);
    });
  });

  void describe('buildOutput - with data', () => {
    void it('includes network requests when present', () => {
      const request: NetworkRequest = {
        requestId: 'req-1',
        timestamp: Date.now(),
        method: 'GET',
        url: 'http://example.com',
        status: 200,
        mimeType: 'text/html',
      };
      store.networkRequests.push(request);

      const output = store.buildOutput();

      assert.ok(output.data.network);
      assert.equal(output.data.network.length, 1);
      assert.deepEqual(output.data.network[0], request);
    });

    void it('includes console messages when present', () => {
      const message: ConsoleMessage = {
        timestamp: Date.now(),
        type: 'log',
        text: 'test message',
        args: [],
      };
      store.consoleMessages.push(message);

      const output = store.buildOutput();

      assert.ok(output.data.console);
      assert.equal(output.data.console.length, 1);
      assert.deepEqual(output.data.console[0], message);
    });

    void it('includes DOM data when present', () => {
      const domData: DOMData = {
        url: 'http://example.com',
        title: 'Example',
        outerHTML: '<html><body>Test</body></html>',
      };
      store.setDomData(domData);

      const output = store.buildOutput();

      assert.ok(output.data.dom);
      assert.deepEqual(output.data.dom, domData);
    });

    void it('includes all data types when all present', () => {
      store.networkRequests.push({
        requestId: 'req-1',
        timestamp: Date.now(),
        method: 'GET',
        url: 'http://example.com',
        status: 200,
        mimeType: 'text/html',
      });
      store.consoleMessages.push({
        timestamp: Date.now(),
        type: 'log',
        text: 'test',
        args: [],
      });
      store.setDomData({
        url: 'http://example.com',
        title: 'Example',
        outerHTML: '<html></html>',
      });

      const output = store.buildOutput();

      assert.ok(output.data.network);
      assert.ok(output.data.console);
      assert.ok(output.data.dom);
    });
  });

  void describe('buildOutput - target info', () => {
    void it('uses target info when set', () => {
      store.setTargetInfo({
        id: 'target-1',
        type: 'page',
        url: 'http://example.com/page',
        title: 'Example Page',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
      });

      const output = store.buildOutput();

      assert.equal(output.target.url, 'http://example.com/page');
      assert.equal(output.target.title, 'Example Page');
    });

    void it('uses empty strings when target info not set', () => {
      const output = store.buildOutput();

      assert.equal(output.target.url, '');
      assert.equal(output.target.title, '');
    });
  });

  void describe('buildOutput - timing', () => {
    void it('calculates duration correctly', () => {
      const testStore = new TelemetryStore();

      // Simulate some time passing
      const elapsed = 100;
      testStore.sessionStartTime = Date.now() - elapsed;

      const output = testStore.buildOutput();
      const after = Date.now();

      // Duration should be approximately the elapsed time
      assert.ok(output.duration >= elapsed);
      assert.ok(output.duration <= after - testStore.sessionStartTime);
    });

    void it('generates ISO timestamp string', () => {
      const output = store.buildOutput();

      // Should be valid ISO 8601 format
      assert.ok(output.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));

      // Should parse back to a valid date
      const parsed = new Date(output.timestamp);
      assert.ok(!isNaN(parsed.getTime()));
    });

    void it('timestamp reflects session start time', () => {
      const startTime = new Date('2024-01-15T12:00:00.000Z').getTime();
      store.sessionStartTime = startTime;

      const output = store.buildOutput();

      assert.equal(output.timestamp, '2024-01-15T12:00:00.000Z');
    });
  });

  void describe('buildOutput - partial flag', () => {
    void it('omits partial flag when partial=false', () => {
      const output = store.buildOutput(false);

      assert.equal('partial' in output, false);
    });

    void it('includes partial flag when partial=true', () => {
      const output = store.buildOutput(true);

      assert.equal(output.partial, true);
    });

    void it('defaults to omitting partial flag', () => {
      const output = store.buildOutput();

      assert.equal('partial' in output, false);
    });
  });

  void describe('data accumulation', () => {
    void it('accumulates multiple network requests', () => {
      store.networkRequests.push(
        {
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://a.com',
          status: 200,
          mimeType: 'text/html',
        },
        {
          requestId: 'req-2',
          timestamp: 200,
          method: 'POST',
          url: 'http://b.com',
          status: 201,
          mimeType: 'application/json',
        },
        {
          requestId: 'req-3',
          timestamp: 300,
          method: 'GET',
          url: 'http://c.com',
          status: 404,
          mimeType: 'text/html',
        }
      );

      const output = store.buildOutput();

      assert.equal(output.data.network?.length, 3);
    });

    void it('accumulates multiple console messages', () => {
      store.consoleMessages.push(
        { timestamp: 100, type: 'log', text: 'msg1', args: [] },
        { timestamp: 200, type: 'error', text: 'msg2', args: [] },
        { timestamp: 300, type: 'warning', text: 'msg3', args: [] }
      );

      const output = store.buildOutput();

      assert.equal(output.data.console?.length, 3);
    });

    void it('preserves order of accumulated data', () => {
      store.networkRequests.push(
        {
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://first.com',
          status: 200,
          mimeType: 'text/html',
        },
        {
          requestId: 'req-2',
          timestamp: 200,
          method: 'GET',
          url: 'http://second.com',
          status: 200,
          mimeType: 'text/html',
        }
      );

      const output = store.buildOutput();

      assert.equal(output.data.network?.[0]?.url, 'http://first.com');
      assert.equal(output.data.network?.[1]?.url, 'http://second.com');
    });
  });

  void describe('output structure properties', () => {
    void it('always has success: true', () => {
      const output = store.buildOutput();

      assert.equal(output.success, true);
    });

    void it('always includes version', () => {
      const output = store.buildOutput();

      assert.equal(output.version, VERSION);
      assert.ok(output.version.match(/^\d+\.\d+\.\d+/));
    });

    void it('always includes data object (even if empty)', () => {
      const output = store.buildOutput();

      assert.ok(typeof output.data === 'object');
      assert.ok(output.data !== null);
    });
  });
});
