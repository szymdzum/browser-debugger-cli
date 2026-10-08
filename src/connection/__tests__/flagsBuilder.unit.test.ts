/**
 * FlagsBuilder Unit Tests
 *
 * Tests for Chrome flags builder functionality including:
 * - Chrome flag construction
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import { describe, test, afterEach } from 'node:test';

import * as chromeLauncher from 'chrome-launcher';

import { buildChromeFlags, dropLauncherHeadlessEnv } from '@/connection/launcher/flagsBuilder.js';

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
    assert.ok(flags.includes('--disable-extensions'));
    assert.ok(
      !flags.some((flag) => flag.startsWith('--remote-debugging-port')),
      'chrome-launcher adds the port flag itself'
    );
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

/**
 * Values of every `prefix` flag in a flag list.
 *
 * @param flags - Chrome flags
 * @param prefix - Flag prefix, e.g. `--disable-features=`
 * @returns The flags' values, one entry per flag
 */
function featureFlagValues(flags: string[], prefix: string): string[] {
  return flags.filter((flag) => flag.startsWith(prefix)).map((flag) => flag.slice(prefix.length));
}

describe('buildChromeFlags feature lists', () => {
  const launcherDefaults = featureFlagValues(
    chromeLauncher.Launcher.defaultFlags(),
    '--disable-features='
  )[0]?.split(',');

  test('passes one --disable-features with the defaults and bdg features', () => {
    const values = featureFlagValues(buildChromeFlags({ port: 9222 }), '--disable-features=');
    assert.strictEqual(values.length, 1);
    const features = values[0]?.split(',') ?? [];
    for (const feature of [...(launcherDefaults ?? []), 'SessionCrashedBubble']) {
      assert.ok(features.includes(feature), `missing ${feature}`);
    }
    assert.strictEqual(new Set(features).size, features.length, 'features are deduplicated');
  });

  test("keeps the defaults and bdg's features when the user disables more", () => {
    const flags = buildChromeFlags({
      port: 9222,
      chromeFlags: ['--disable-features=Foo,Translate', '--disable-features=Bar'],
    });
    const values = featureFlagValues(flags, '--disable-features=');
    assert.strictEqual(values.length, 1);
    const features = values[0]?.split(',') ?? [];
    assert.deepStrictEqual(features.slice(-2), ['Foo', 'Bar']);
    assert.ok(features.includes('OptimizationHints'));
    assert.ok(features.includes('SessionCrashedBubble'));
    assert.strictEqual(features.filter((f) => f === 'Translate').length, 1);
  });

  test('merges --enable-features the same way', () => {
    const flags = buildChromeFlags({
      port: 9222,
      chromeFlags: ['--enable-features=A,B', '--enable-features=B,C'],
    });
    assert.deepStrictEqual(featureFlagValues(flags, '--enable-features='), ['A,B,C']);
  });
});

describe('buildChromeFlags duplicates', () => {
  for (const ignoreDefaultFlags of [false, true]) {
    test(`passes each flag once (ignoreDefaultFlags: ${ignoreDefaultFlags})`, () => {
      const flags = buildChromeFlags({ port: 9222, ignoreDefaultFlags });
      assert.deepStrictEqual(flags, [...new Set(flags)]);
      assert.ok(flags.includes('--no-first-run'));
      assert.ok(flags.includes('--no-default-browser-check'));
    });
  }
});

describe('dropLauncherHeadlessEnv', () => {
  const original = process.env['HEADLESS'];

  afterEach(() => {
    if (original === undefined) delete process.env['HEADLESS'];
    else process.env['HEADLESS'] = original;
  });

  /**
   * Flags chrome-launcher would pass to Chrome for a headed bdg launch.
   *
   * @returns chrome-launcher's final flag list
   */
  function launcherFlags(): string[] {
    const launcher = new chromeLauncher.Launcher({
      ignoreDefaultFlags: true,
      chromeFlags: buildChromeFlags({ port: 9222 }),
      userDataDir: '/tmp/bdg-flags-test-profile',
      port: 9222,
    });
    return launcher['flags'] as string[];
  }

  test('chrome-launcher forces --headless while HEADLESS is set', () => {
    process.env['HEADLESS'] = '0';
    assert.ok(launcherFlags().includes('--headless'));
  });

  test('a headed launch stays headed after HEADLESS is dropped', () => {
    process.env['HEADLESS'] = '1';
    dropLauncherHeadlessEnv();
    assert.strictEqual(process.env['HEADLESS'], undefined);
    assert.ok(!launcherFlags().some((flag) => flag.startsWith('--headless')));
  });
});
