/**
 * Unit tests for TelemetryStore
 *
 * Tests the contract: empty initial state and the state setters.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import type { CDPTarget } from '@/types.js';

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

    void it('sets navigation resolver function', () => {
      const resolver = (): number => 42;
      store.setNavigationResolver(resolver);

      assert.equal(store.getCurrentNavigationId, resolver);
    });

    void it('resets session start time', async () => {
      const original = store.sessionStartTime;
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.resetSessionStart();
      assert.ok(store.sessionStartTime > original);
    });
  });
});
