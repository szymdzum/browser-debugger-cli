/**
 * Chrome installation diagnostics in launch errors: with no Chrome found,
 * point at CHROME_PATH for other Chromium-based browsers (#496).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDiagnosticsForError } from '@/ui/messages/chrome.js';

const NONE = { defaultPath: null, installations: [], installationCount: 0 };

void describe('formatDiagnosticsForError', () => {
  void it('suggests CHROME_PATH with a macOS Edge example when no Chrome is found', () => {
    const text = formatDiagnosticsForError(NONE, 'darwin').join('\n');
    assert.match(text, /No Chrome installations detected/);
    assert.match(text, /Set CHROME_PATH to a Chromium-based browser/);
    assert.ok(
      text.includes(
        'CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" bdg <url>'
      )
    );
    assert.doesNotMatch(text, /port/i);
  });

  void it('uses a Linux path in the example on Linux', () => {
    const text = formatDiagnosticsForError(NONE, 'linux').join('\n');
    assert.ok(text.includes('CHROME_PATH="/usr/bin/microsoft-edge" bdg <url>'));
  });

  void it('lists the installations found, without CHROME_PATH', () => {
    const text = formatDiagnosticsForError({
      defaultPath: '/opt/chrome',
      installations: ['/opt/chrome'],
      installationCount: 1,
    }).join('\n');
    assert.match(text, /1\. \/opt\/chrome/);
    assert.doesNotMatch(text, /CHROME_PATH/);
  });
});
