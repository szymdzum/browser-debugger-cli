/**
 * The classifier of `Page.navigate` errors that `bdg URL` and `page navigate`
 * share (#860): every `net::` name of the load-failure matrix (#862) and of
 * the issue, with a loader (a document was being loaded) and without.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { navigationOutcome } from '@/connection/navigationOutcome.js';

/** Errors that end on Chrome's error page */
const FAILURES = [
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NAME_RESOLUTION_FAILED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_FAILED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CONNECTION_ABORTED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  'ERR_FILE_NOT_FOUND',
  'ERR_UNSAFE_PORT',
  'ERR_INVALID_URL',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
  'ERR_TOO_MANY_REDIRECTS',
  'ERR_UNSAFE_REDIRECT',
  'ERR_INVALID_REDIRECT',
  'ERR_CONTENT_LENGTH_MISMATCH',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_BLOCKED_BY_RESPONSE',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_ACCESS_DENIED',
  'ERR_UNKNOWN_URL_SCHEME',
  'ERR_FAILED',
];

/** Errors that still leave a page worth inspecting: an HTTP error page, a certificate interstitial */
const PAGES = ['ERR_HTTP_RESPONSE_CODE_FAILURE'];

/** Certificate errors: a success with a warning (owner decision on #860) */
const CERTIFICATES = [
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
];

void describe('navigationOutcome', () => {
  for (const name of FAILURES) {
    void it(`net::${name} fails, with a loader and without`, () => {
      assert.equal(navigationOutcome(`net::${name}`, 'loader'), 'failed');
      assert.equal(navigationOutcome(`net::${name}`), 'failed');
    });
  }

  for (const name of PAGES) {
    void it(`net::${name} loads a page`, () => {
      assert.equal(navigationOutcome(`net::${name}`, 'loader'), 'loaded');
    });
  }

  for (const name of CERTIFICATES) {
    void it(`net::${name} is the certificate warning: a success with a warning`, () => {
      assert.equal(navigationOutcome(`net::${name}`, 'loader'), 'certificate');
    });
  }

  void it('net::ERR_ABORTED without a loader is a download, with one a 204 that keeps the page', () => {
    assert.equal(navigationOutcome('net::ERR_ABORTED'), 'not-a-page');
    assert.equal(navigationOutcome('net::ERR_ABORTED', 'loader'), 'loaded');
  });

  void it('no error loads the page', () => {
    assert.equal(navigationOutcome(undefined, 'loader'), 'loaded');
    assert.equal(navigationOutcome(''), 'loaded');
  });
});
