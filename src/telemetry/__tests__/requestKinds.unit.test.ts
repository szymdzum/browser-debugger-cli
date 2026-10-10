/**
 * Which requests an action triggered may carry a form's data (#591): a
 * blocked submit is still read when the page only loaded assets meanwhile.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mayCarrySubmit } from '@/telemetry/requestKinds.js';

void describe('mayCarrySubmit', () => {
  void it('is false for assets fetched with GET, also failed ones', () => {
    assert.equal(mayCarrySubmit({ method: 'GET', resourceType: 'Image' }), false);
    assert.equal(mayCarrySubmit({ method: 'GET', resourceType: 'Font', status: 200 }), false);
    assert.equal(mayCarrySubmit({ method: 'GET', resourceType: 'Image', status: 404 }), false);
    assert.equal(
      mayCarrySubmit({ method: 'GET', resourceType: 'Stylesheet', failed: true }),
      false
    );
  });

  void it('is true for pages, API calls, requests of unknown type and non-GET requests', () => {
    assert.equal(mayCarrySubmit({ method: 'GET', resourceType: 'Document' }), true);
    assert.equal(mayCarrySubmit({ method: 'POST', resourceType: 'Fetch' }), true);
    assert.equal(mayCarrySubmit({ method: 'GET', resourceType: 'XHR' }), true);
    assert.equal(mayCarrySubmit({ method: 'GET' }), true);
    assert.equal(mayCarrySubmit({ method: 'POST', resourceType: 'Other' }), true);
  });
});
