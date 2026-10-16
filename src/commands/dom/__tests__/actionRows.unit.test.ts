/**
 * The `Errors:` and `Selector:` rows of an action's human output (#694): a
 * click whose only errors came from filtered trackers says the page had none
 * (not an orphan `(+2 from filtered trackers)`), and an index into a
 * `dom a11y query` list shows the unique selector bdg computed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatClickOutput } from '@/commands/dom/formInteraction.js';

type Click = Parameters<typeof formatClickOutput>[0];

const click = (extra: Partial<Click>): string[] =>
  formatClickOutput({ method: 'mouse', action: 'click', ...extra }).split('\n');

const a11yIndex = {
  index: 1,
  command: 'dom a11y query',
  query: 'role=button',
} as const;

void describe('Errors: row with tracker errors only (#694)', () => {
  void it('says the page had none and how to see the hidden ones', () => {
    const lines = click({
      selector: '#trk',
      element: 'button#trk "Track"',
      hiddenTrackerErrors: 2,
    });
    assert.ok(
      lines.includes(
        'Errors:        none from the page (2 from filtered trackers hidden; bdg console --level error)'
      ),
      lines.join('\n')
    );
  });

  void it('keeps the (+N from filtered trackers) tail after page errors', () => {
    const lines = click({
      selector: '#mixed',
      element: 'button#mixed "Mixed"',
      errors: [{ text: 'app failed', source: 'http://x/app.js:1:1', count: 1 }],
      hiddenTrackerErrors: 2,
    });
    assert.ok(
      lines.some((line) => line.startsWith('Errors:        app failed')),
      lines.join('\n')
    );
    assert.ok(lines.includes('               (+2 from filtered trackers)'), lines.join('\n'));
  });
});

void describe('Selector: row for an a11y index (#694)', () => {
  void it('follows Element: with the unique selector', () => {
    const lines = click({
      selector: 'html > body > button:nth-of-type(2)',
      element: 'button.b "Cancel"',
      indexSource: a11yIndex,
    });
    const at = lines.indexOf(
      'Element:       button.b "Cancel" (index 1 of the last dom a11y query "role=button")'
    );
    assert.ok(at >= 0, lines.join('\n'));
    assert.equal(lines[at + 1], 'Selector:      html > body > button:nth-of-type(2)');
  });

  void it('shows a path that starts at an ancestor id', () => {
    const lines = click({
      selector: '#nav > mdn-dropdown > button',
      element: 'button.tab "CSS"',
      indexSource: a11yIndex,
    });
    assert.ok(lines.includes('Selector:      #nav > mdn-dropdown > button'), lines.join('\n'));
  });

  void it('adds no row when the element is already named by its id', () => {
    const lines = click({
      selector: '#save',
      element: 'button#save "Save"',
      indexSource: a11yIndex,
    });
    assert.ok(!lines.some((line) => line.startsWith('Selector:')), lines.join('\n'));
  });

  void it('adds no row when bdg computed no selector', () => {
    const lines = click({ element: 'button.b "Cancel"', indexSource: a11yIndex });
    assert.ok(!lines.some((line) => line.startsWith('Selector:')), lines.join('\n'));
  });
});
