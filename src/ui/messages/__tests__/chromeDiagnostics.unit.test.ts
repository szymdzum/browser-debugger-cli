/**
 * Chrome installation diagnostics in launch errors: with no Chrome found,
 * point at CHROME_PATH for other Chromium-based browsers (#496).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChromeDiagnostics } from '@/connection/diagnostics.js';
import { formatChromeIssue, formatDiagnosticsForError } from '@/ui/messages/chrome.js';

const NONE: ChromeDiagnostics = { defaultPath: null, installations: [], installationCount: 0 };
const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const ONLY_DEFAULT: ChromeDiagnostics = {
  defaultPath: EDGE,
  installations: [],
  installationCount: 0,
};
const LAUNCH_FAILED = {
  code: 'CHROME_LAUNCH_FAILED' as const,
  context: { port: 9222, reason: 'No Chrome installations found.' },
};

void describe('formatDiagnosticsForError', () => {
  void it('suggests CHROME_PATH with a macOS Edge example when no Chrome is found', () => {
    const text = formatDiagnosticsForError(NONE, { platform: 'darwin' }).join('\n');
    assert.match(text, /No Chrome installations detected/);
    assert.match(text, /Set CHROME_PATH to a Chromium-based browser/);
    assert.ok(text.includes(`CHROME_PATH="${EDGE}" bdg <url>`));
    assert.doesNotMatch(text, /port/i);
  });

  void it('uses a Linux path in the example on Linux', () => {
    const text = formatDiagnosticsForError(NONE, { platform: 'linux' }).join('\n');
    assert.ok(text.includes('CHROME_PATH="/usr/bin/microsoft-edge" bdg <url>'));
  });

  void it('gives no example path on Windows', () => {
    const text = formatDiagnosticsForError(NONE, { platform: 'win32' }).join('\n');
    assert.match(text, /Set CHROME_PATH to a Chromium-based browser/);
    assert.doesNotMatch(text, /CHROME_PATH="/);
  });

  void it('leaves CHROME_PATH out when it is the problem', () => {
    const text = formatDiagnosticsForError(NONE, { suggestChromePath: false }).join('\n');
    assert.match(text, /Install Chrome from/);
    assert.doesNotMatch(text, /CHROME_PATH/);
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

  void it('shows the default binary when only CHROME_PATH found one', () => {
    const text = formatDiagnosticsForError(ONLY_DEFAULT).join('\n');
    assert.ok(text.includes(`Default binary: ${EDGE}`));
    assert.doesNotMatch(text, /No Chrome installations detected/);
  });
});

void describe('formatChromeIssue with Chrome diagnostics', () => {
  void it('drops the port hints when no Chrome is found', () => {
    const text = formatChromeIssue(LAUNCH_FAILED, () => NONE);
    assert.match(text, /No Chrome installations found/);
    assert.match(text, /Set CHROME_PATH/);
    assert.doesNotMatch(text, /port/i);
  });

  void it('keeps the port hints when a default binary exists', () => {
    const text = formatChromeIssue(LAUNCH_FAILED, () => ONLY_DEFAULT);
    assert.match(text, /Possible causes:/);
    assert.match(text, /Port 9222 conflict/);
    assert.doesNotMatch(text, /Set CHROME_PATH/);
  });

  void it('says the CHROME_PATH override is wrong instead of suggesting it', () => {
    const text = formatChromeIssue(
      {
        code: 'CHROME_BINARY_NOT_FOUND',
        context: { chromePath: '/nope/chrome', source: 'CHROME_PATH' },
      },
      () => NONE
    );
    assert.match(text, /\/nope\/chrome/);
    assert.doesNotMatch(text, /Set CHROME_PATH/);
  });
});
