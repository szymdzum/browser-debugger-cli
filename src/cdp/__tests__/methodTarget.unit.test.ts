/**
 * What `bdg cdp <name>` does with a name: run a bundled method, send a
 * well-formed method the bundled protocol lacks, or suggest the method a
 * typo was meant to be.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveMethodTarget } from '@/cdp/methodTarget.js';

void describe('resolveMethodTarget', () => {
  void it('normalizes bundled methods', () => {
    assert.deepEqual(resolveMethodTarget('network.getcookies'), {
      kind: 'known',
      method: 'Network.getCookies',
    });
  });

  void it('sends well-formed methods missing from the bundled protocol as typed', () => {
    assert.deepEqual(resolveMethodTarget('Storage.getRelatedWebsiteSets'), {
      kind: 'unlisted',
      method: 'Storage.getRelatedWebsiteSets',
    });
    assert.deepEqual(resolveMethodTarget('Foo.bar'), { kind: 'unlisted', method: 'Foo.bar' });
    assert.deepEqual(resolveMethodTarget('Nonexistent.method'), {
      kind: 'unlisted',
      method: 'Nonexistent.method',
    });
  });

  void it('fixes only the casing of a known domain', () => {
    assert.deepEqual(resolveMethodTarget('storage.getRelatedWebsiteSets'), {
      kind: 'unlisted',
      method: 'Storage.getRelatedWebsiteSets',
    });
  });

  void it('takes a method 1-2 letters off a bundled one for a typo', () => {
    assert.deepEqual(resolveMethodTarget('Network.getCookes'), {
      kind: 'typo',
      suggestions: ['Network.getCookies', 'Network.setCookies'],
    });
    const enable = resolveMethodTarget('Page.enabel');
    assert.equal(enable.kind, 'typo');
  });

  void it('takes a domain 1-2 letters off a bundled one for a typo', () => {
    assert.deepEqual(resolveMethodTarget('Netwrk.getCookies'), {
      kind: 'typo',
      suggestions: ['Network.getCookies'],
    });
    assert.deepEqual(resolveMethodTarget('Netwrok.fooBar'), { kind: 'typo', suggestions: [] });
  });

  void it('tells a type from a method', () => {
    assert.deepEqual(resolveMethodTarget('Network.CookieSameSite'), {
      kind: 'type',
      name: 'Network.CookieSameSite',
    });
  });

  void it('rejects names that are not Domain.method', () => {
    assert.deepEqual(resolveMethodTarget('getCookies'), { kind: 'malformed' });
    assert.deepEqual(resolveMethodTarget('Network.get-cookies'), { kind: 'malformed' });
    assert.deepEqual(resolveMethodTarget('Network.getCookies.x'), { kind: 'malformed' });
  });
});
