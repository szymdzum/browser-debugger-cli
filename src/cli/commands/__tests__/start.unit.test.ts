import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateCollectorFlags, resolveCollectors } from '@/cli/commands/start.js';
import type { CollectorType } from '@/types';

/**
 * Unit tests for collector flag validation and resolution
 */
void describe('validateCollectorFlags', () => {
  void it('should not throw when no collector flags are provided', () => {
    assert.doesNotThrow(() => {
      validateCollectorFlags({ port: '9222' });
    });
  });

  void it('should not throw when only additive flags are provided', () => {
    assert.doesNotThrow(() => {
      validateCollectorFlags({ port: '9222', dom: true, network: true });
    });
  });

  void it('should not throw when only subtractive flags are provided', () => {
    assert.doesNotThrow(() => {
      validateCollectorFlags({ port: '9222', skipDom: true });
    });
  });

  void it('should throw when --dom and --skip-dom are both provided', () => {
    assert.throws(
      () => {
        validateCollectorFlags({ port: '9222', dom: true, skipDom: true });
      },
      {
        name: 'Error',
        message: /Conflicting collector flags detected: --dom and --skip-dom/,
      }
    );
  });

  void it('should throw when --network and --skip-network are both provided', () => {
    assert.throws(
      () => {
        validateCollectorFlags({ port: '9222', network: true, skipNetwork: true });
      },
      {
        name: 'Error',
        message: /Conflicting collector flags detected: --network and --skip-network/,
      }
    );
  });

  void it('should throw when --console and --skip-console are both provided', () => {
    assert.throws(
      () => {
        validateCollectorFlags({ port: '9222', console: true, skipConsole: true });
      },
      {
        name: 'Error',
        message: /Conflicting collector flags detected: --console and --skip-console/,
      }
    );
  });

  void it('should throw when multiple conflicts are present', () => {
    assert.throws(
      () => {
        validateCollectorFlags({
          port: '9222',
          dom: true,
          skipDom: true,
          network: true,
          skipNetwork: true,
        });
      },
      {
        name: 'Error',
        message:
          /Conflicting collector flags detected.*--dom and --skip-dom.*--network and --skip-network/s,
      }
    );
  });
});

void describe('resolveCollectors', () => {
  void it('should return all collectors when no flags are provided', () => {
    const collectors = resolveCollectors({ port: '9222' });
    assert.deepEqual(collectors, ['dom', 'network', 'console']);
  });

  void it('should return only dom when --dom is provided', () => {
    const collectors = resolveCollectors({ port: '9222', dom: true });
    assert.deepEqual(collectors, ['dom']);
  });

  void it('should return only network when --network is provided', () => {
    const collectors = resolveCollectors({ port: '9222', network: true });
    assert.deepEqual(collectors, ['network']);
  });

  void it('should return only console when --console is provided', () => {
    const collectors = resolveCollectors({ port: '9222', console: true });
    assert.deepEqual(collectors, ['console']);
  });

  void it('should return dom and network when both additive flags are provided', () => {
    const collectors = resolveCollectors({ port: '9222', dom: true, network: true });
    assert.deepEqual(collectors, ['dom', 'network']);
  });

  void it('should return all three when all additive flags are provided', () => {
    const collectors = resolveCollectors({
      port: '9222',
      dom: true,
      network: true,
      console: true,
    });
    assert.deepEqual(collectors, ['dom', 'network', 'console']);
  });

  void it('should exclude dom when --skip-dom is provided', () => {
    const collectors = resolveCollectors({ port: '9222', skipDom: true });
    assert.deepEqual(collectors, ['network', 'console']);
  });

  void it('should exclude network when --skip-network is provided', () => {
    const collectors = resolveCollectors({ port: '9222', skipNetwork: true });
    assert.deepEqual(collectors, ['dom', 'console']);
  });

  void it('should exclude console when --skip-console is provided', () => {
    const collectors = resolveCollectors({ port: '9222', skipConsole: true });
    assert.deepEqual(collectors, ['dom', 'network']);
  });

  void it('should exclude multiple collectors when multiple --skip-* flags are provided', () => {
    const collectors = resolveCollectors({
      port: '9222',
      skipDom: true,
      skipNetwork: true,
    });
    assert.deepEqual(collectors, ['console']);
  });

  void it('should return empty array when all collectors are disabled', () => {
    const collectors = resolveCollectors({
      port: '9222',
      skipDom: true,
      skipNetwork: true,
      skipConsole: true,
    });
    assert.deepEqual(collectors, [] as CollectorType[]);
  });

  void it('should prioritize additive flags over subtractive flags', () => {
    // When additive flags are present, subtractive flags should be ignored
    const collectors = resolveCollectors({
      port: '9222',
      dom: true,
      skipConsole: true, // Should be ignored because additive flag is present
    });
    assert.deepEqual(collectors, ['dom']);
  });
});
