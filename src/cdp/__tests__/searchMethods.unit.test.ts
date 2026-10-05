/**
 * `bdg cdp --search` finds methods by the words agents use (#332): keywords
 * such as "viewport", names written with spaces, and name matches first.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { searchMethods } from '@/cdp/schema.js';

/**
 * Names of the methods a search finds.
 *
 * @param query - Search query
 * @returns Method names in result order
 */
function names(query: string): string[] {
  return searchMethods(query).map((method) => method.name);
}

void describe('searchMethods', () => {
  void it('puts Emulation.setDeviceMetricsOverride first for viewport and window size', () => {
    assert.equal(names('viewport')[0], 'Emulation.setDeviceMetricsOverride');
    assert.ok(names('window size').includes('Emulation.setDeviceMetricsOverride'));
  });

  void it('finds setEmulatedMedia for color scheme and dark mode', () => {
    assert.ok(names('color scheme').includes('Emulation.setEmulatedMedia'));
    assert.ok(names('dark mode').includes('Emulation.setEmulatedMedia'));
  });

  void it('matches names written with spaces and lists name matches before description matches', () => {
    assert.ok(names('user agent').includes('Emulation.setUserAgentOverride'));
    const cookies = names('cookie');
    const firstDescribed = cookies.findIndex((name) => !/cookie/i.test(name));
    if (firstDescribed !== -1) {
      assert.ok(cookies.slice(firstDescribed).every((name) => !/cookie/i.test(name)));
    }
  });
});
