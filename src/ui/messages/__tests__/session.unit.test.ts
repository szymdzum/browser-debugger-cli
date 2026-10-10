/**
 * The start output stays a few lines (#332): target, notices, one line of
 * next commands (screenshot last) and a pointer to `--help`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { landingPage } from '@/ui/messages/session.js';

void describe('landingPage', () => {
  void it('is at most a handful of lines', () => {
    const lines = landingPage({ url: 'http://localhost:3000/' }).split('\n');
    assert.deepEqual(lines.slice(0, 2), ['Session Started', 'Target: http://localhost:3000/']);
    assert.ok(lines.length <= 8, `${lines.length} lines`);
    assert.equal(lines.at(-1), 'More: bdg --help (bdg --help --json for agents)');
  });

  void it('lists layout, query, form and peek before screenshot', () => {
    const next = landingPage({ url: 'http://x/' })
      .split('\n')
      .find((line) => line.startsWith('Next: '));
    assert.ok(next);
    const at = (command: string): number => next.indexOf(command);
    for (const command of ['bdg dom layout', 'bdg dom query', 'bdg dom form', 'bdg peek']) {
      assert.ok(at(command) >= 0 && at(command) < at('bdg dom screenshot'), command);
    }
  });

  void it('keeps the session name, HTTP error and auto-stop notices', () => {
    const text = landingPage({
      url: 'http://x/',
      session: 'agent-1',
      documentStatus: 503,
      autoStopAt: new Date(),
    });
    assert.match(text, /^Session: agent-1 /m);
    assert.match(text, /HTTP 503/);
    assert.match(text, /^Auto-stop: /m);
    assert.ok(text.split('\n').length <= 8);
  });

  void it('lists the dialogs answered while the page loaded (#553)', () => {
    const text = landingPage({
      url: 'http://x/',
      dialogs: [{ type: 'confirm', message: 'Continue loading?', answer: 'dismissed' }],
    });
    assert.match(text, /^Dialog: confirm\(\) dismissed: "Continue loading\?"$/m);
  });
});
