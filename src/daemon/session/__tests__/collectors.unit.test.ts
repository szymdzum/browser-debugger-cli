/**
 * Starting the telemetry collectors: a collector failing to start releases
 * the ones started before it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { startTelemetryCollectors } from '@/daemon/session/collectors.js';
import type { TelemetryPlugin } from '@/daemon/session/plugins.js';
import { createLogger } from '@/ui/logging/index.js';

void describe('startTelemetryCollectors', () => {
  void it('runs the cleanups of started collectors when a later one fails, then rethrows', async () => {
    const cleaned: string[] = [];
    const plugins: TelemetryPlugin[] = [
      {
        name: 'first',
        runAlways: true,
        start: () => Promise.resolve(() => void cleaned.push('first')),
      },
      {
        name: 'second',
        runAlways: true,
        start: () =>
          Promise.resolve(() => {
            cleaned.push('second');
            throw new Error('cleanup failed');
          }),
      },
      { name: 'broken', runAlways: true, start: () => Promise.reject(new Error('start failed')) },
    ];

    await assert.rejects(
      startTelemetryCollectors(
        {} as CDPConnection,
        { url: 'http://x.test', port: 9222 },
        new TelemetryStore(),
        createLogger('session'),
        plugins
      ),
      /start failed/
    );
    assert.deepEqual(cleaned, ['first', 'second']);
  });
});
