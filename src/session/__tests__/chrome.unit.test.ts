/**
 * `status --verbose` reads the session's Chrome from its command line.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseChromeCommand } from '@/session/chrome.js';

void describe('parseChromeCommand', () => {
  void it('keeps spaces in the executable and profile paths', () => {
    const info = parseChromeCommand(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --user-data-dir=/Users/x/My Profile --remote-debugging-port=9222'
    );
    assert.deepEqual(info, {
      executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      userDataDir: '/Users/x/My Profile',
    });
  });

  void it('reports a Chrome with a window and no profile flag', () => {
    assert.deepEqual(parseChromeCommand('/usr/bin/chrome --no-first-run'), {
      executable: '/usr/bin/chrome',
      headless: false,
    });
  });
});
