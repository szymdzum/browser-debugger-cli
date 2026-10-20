/**
 * An action whose navigation ends on Chrome's error page exits 80 and keeps
 * what it did (#873).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatClickOutput } from '@/commands/dom/formInteraction.js';
import { failOnNavigationFailed } from '@/commands/dom/helpers/navigationFailed.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const navigationFailed = {
  url: 'http://127.0.0.1:9/',
  errorText: 'net::ERR_CONNECTION_REFUSED',
};

const clicked = {
  selector: '#go',
  method: 'mouse' as const,
  navigation: { url: 'chrome-error://chromewebdata/', sameDocument: false },
};

void describe('failOnNavigationFailed (#873)', () => {
  void it('fails with exit 80 naming the URL and the network error, keeping the data', () => {
    const result = failOnNavigationFailed({
      success: true,
      data: { ...clicked, navigationFailed, warning: 'covered' },
    });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, EXIT_CODES.INVALID_URL);
    assert.match(result.error ?? '', /http:\/\/127\.0\.0\.1:9\/.*net::ERR_CONNECTION_REFUSED/);
    assert.deepEqual(result.data, { ...clicked, navigationFailed });
    assert.equal(result.warning, 'covered');
    assert.equal(typeof result.errorContext?.['suggestion'], 'string');
  });

  void it('leaves a navigation that loaded and a failed action as they are', () => {
    const loaded = { success: true, data: clicked };
    assert.equal(failOnNavigationFailed(loaded), loaded);
    const failed = { success: false, error: 'Element not found', exitCode: 83 };
    assert.equal(failOnNavigationFailed(failed), failed);
  });

  void it('puts a ⚠ verdict naming the error in place of the ✓ line', () => {
    const [verdict] = formatClickOutput({ ...clicked, action: 'click', navigationFailed }).split(
      '\n'
    );
    assert.equal(verdict, '⚠ Element Clicked (navigation failed: net::ERR_CONNECTION_REFUSED)');
  });
});
