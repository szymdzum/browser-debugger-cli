/**
 * FlagsBuilder Unit Tests
 *
 * Tests for Chrome flags builder functionality including:
 * - Chrome flag construction
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import { describe, test, afterEach } from 'node:test';

import { buildChromeFlags } from '@/connection/launcher/flagsBuilder.js';

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

describe('buildChromeFlags session marker', () => {
  test('adds the session marker flag when a session dir is given', () => {
    const flags = buildChromeFlags({ port: 9222, sessionDir: '/tmp/bdg-x' });
    assert.ok(flags.includes('--bdg-session-dir=/tmp/bdg-x'));
  });

  test('omits the marker without a session dir', () => {
    const flags = buildChromeFlags({ port: 9222 });
    assert.ok(!flags.some((f) => f.startsWith('--bdg-session-dir=')));
  });
});

describe('buildChromeFlags sandbox', () => {
  afterEach(() => {
    delete process.env['BDG_NO_SANDBOX'];
  });

  test('adds --no-sandbox when BDG_NO_SANDBOX=1', () => {
    process.env['BDG_NO_SANDBOX'] = '1';
    assert.ok(buildChromeFlags({ port: 9222 }).includes('--no-sandbox'));
  });

  test('keeps the sandbox on a regular (non-root, non-Docker) host', () => {
    if (process.getuid?.() === 0 || fs.existsSync('/.dockerenv')) return;
    assert.ok(!buildChromeFlags({ port: 9222 }).includes('--no-sandbox'));
  });
});
