/**
 * Blocked cookie reasons as `details network` says them.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { blockedCookieReason } from '@/ui/messages/networkMessages.js';

void describe('blockedCookieReason', () => {
  const notSent = (...reasons: string[]): string =>
    blockedCookieReason({ name: 'sid', kind: 'not-sent', reasons });

  void it('explains the common Chrome reasons and keeps the raw one (#567)', () => {
    for (const reason of [
      'SameSiteLax',
      'SameSiteStrict',
      'SchemefulSameSiteLax',
      'SameSiteNoneInsecure',
      'ThirdPartyPhaseout',
      'DomainMismatch',
      'SecureOnly',
    ]) {
      const text = notSent(reason);
      assert.ok(text.startsWith(`not sent: ${reason} (`), text);
    }
  });

  void it('leaves an unknown reason as it is', () => {
    assert.equal(notSent('SomethingNew'), 'not sent: SomethingNew');
  });

  void it('explains each of several reasons', () => {
    assert.match(
      notSent('SecureOnly', 'DomainMismatch'),
      /SecureOnly \(.+\), DomainMismatch \(.+\)/
    );
  });
});
