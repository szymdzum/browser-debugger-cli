/**
 * FlagsBuilder Unit Tests
 *
 * Tests for Chrome flags builder functionality including:
 * - Environment variable parsing (BDG_CHROME_FLAGS)
 * - Chrome flag construction
 */

import * as assert from 'node:assert';
import { describe, test, afterEach } from 'node:test';

import { getEnvChromeFlags, buildChromeFlags } from '@/connection/launcher/flagsBuilder.js';

describe('getEnvChromeFlags', () => {
  const originalEnv = process.env['BDG_CHROME_FLAGS'];

  afterEach(() => {
    // Restore original env var
    if (originalEnv === undefined) {
      delete process.env['BDG_CHROME_FLAGS'];
    } else {
      process.env['BDG_CHROME_FLAGS'] = originalEnv;
    }
  });

  test('returns empty array when BDG_CHROME_FLAGS is not set', () => {
    delete process.env['BDG_CHROME_FLAGS'];
    const flags = getEnvChromeFlags();
    assert.deepStrictEqual(flags, []);
  });

  test('returns empty array when BDG_CHROME_FLAGS is empty string', () => {
    process.env['BDG_CHROME_FLAGS'] = '';
    const flags = getEnvChromeFlags();
    assert.deepStrictEqual(flags, []);
  });

  test('parses single flag correctly', () => {
    process.env['BDG_CHROME_FLAGS'] = '--ignore-certificate-errors';
    const flags = getEnvChromeFlags();
    assert.deepStrictEqual(flags, ['--ignore-certificate-errors']);
  });

  test('parses multiple space-separated flags', () => {
    process.env['BDG_CHROME_FLAGS'] = '--ignore-certificate-errors --disable-web-security';
    const flags = getEnvChromeFlags();
    assert.deepStrictEqual(flags, ['--ignore-certificate-errors', '--disable-web-security']);
  });

  test('handles flags with values (equals sign)', () => {
    process.env['BDG_CHROME_FLAGS'] = '--window-size=1920,1080 --proxy-server=localhost:8080';
    const flags = getEnvChromeFlags();
    assert.deepStrictEqual(flags, ['--window-size=1920,1080', '--proxy-server=localhost:8080']);
  });

  test('filters out empty strings from multiple spaces', () => {
    process.env['BDG_CHROME_FLAGS'] = '--flag1   --flag2';
    const flags = getEnvChromeFlags();
    assert.deepStrictEqual(flags, ['--flag1', '--flag2']);
  });
});

describe('buildChromeFlags with custom flags', () => {
  // BDG_CHROME_FLAGS env var is parsed by CLI in src/commands/start.ts
  // and passed via chromeFlags option. buildChromeFlags only receives the merged array.

  test('includes chromeFlags in output', () => {
    const flags = buildChromeFlags({
      port: 9222,
      chromeFlags: ['--ignore-certificate-errors'],
    });
    assert.ok(flags.includes('--ignore-certificate-errors'));
  });

  test('includes multiple chromeFlags in output', () => {
    const flags = buildChromeFlags({
      port: 9222,
      chromeFlags: ['--ignore-certificate-errors', '--disable-web-security'],
    });
    assert.ok(flags.includes('--ignore-certificate-errors'));
    assert.ok(flags.includes('--disable-web-security'));
  });

  test('chromeFlags are appended at the end', () => {
    const flags = buildChromeFlags({
      port: 9222,
      chromeFlags: ['--custom-flag'],
    });
    const customIndex = flags.indexOf('--custom-flag');
    assert.strictEqual(customIndex, flags.length - 1, 'Custom flags should be at the end');
  });

  test('works with headless mode and custom flags', () => {
    const flags = buildChromeFlags({
      port: 9222,
      headless: true,
      chromeFlags: ['--ignore-certificate-errors', '--disable-web-security'],
    });
    assert.ok(flags.includes('--headless=new'));
    assert.ok(flags.includes('--ignore-certificate-errors'));
    assert.ok(flags.includes('--disable-web-security'));
  });

  test('works without chromeFlags option', () => {
    const flags = buildChromeFlags({ port: 9222 });
    assert.ok(flags.includes('--remote-debugging-port=9222'));
  });
});
