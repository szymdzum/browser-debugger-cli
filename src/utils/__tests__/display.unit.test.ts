/**
 * Whether Chrome gets a window by default.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasDisplay } from '@/utils/display.js';

void describe('hasDisplay', () => {
  void it('shows a window on a Mac desktop, not over SSH or in CI', () => {
    assert.equal(hasDisplay({}, 'darwin'), true);
    assert.equal(hasDisplay({ SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22' }, 'darwin'), false);
    assert.equal(hasDisplay({ SSH_TTY: '/dev/ttys001' }, 'darwin'), false);
    assert.equal(hasDisplay({ CI: 'true' }, 'darwin'), false);
    assert.equal(hasDisplay({ CI: '' }, 'darwin'), true);
  });

  void it('needs an X11 or Wayland display on Linux', () => {
    assert.equal(hasDisplay({}, 'linux'), false);
    assert.equal(hasDisplay({ DISPLAY: ':0' }, 'linux'), true);
    assert.equal(hasDisplay({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
    assert.equal(hasDisplay({ DISPLAY: '' }, 'linux'), false);
  });
});
