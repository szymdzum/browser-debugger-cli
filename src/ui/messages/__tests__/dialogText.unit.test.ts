/**
 * The one-line text of an answered dialog, in console messages and labelled
 * `Dialog:` in action results (#450).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dialogConsoleText } from '@/ui/messages/commands.js';

void describe('dialogConsoleText', () => {
  void it('names the answer, and the text an answered prompt got', () => {
    assert.equal(
      dialogConsoleText({ type: 'alert', message: 'Saved', answer: 'accepted' }),
      'alert() dialog accepted: "Saved"'
    );
    assert.equal(
      dialogConsoleText(
        { type: 'prompt', message: 'Name?', answer: 'accepted', promptText: 'Ada' },
        { labelled: true }
      ),
      'prompt() accepted: "Name?" (answered "Ada")'
    );
    assert.equal(
      dialogConsoleText(
        { type: 'confirm', message: 'Sure?', answer: 'dismissed' },
        { labelled: true }
      ),
      'confirm() dismissed: "Sure?"'
    );
    assert.equal(
      dialogConsoleText({ type: 'beforeunload', message: '', answer: 'dismissed' }),
      'beforeunload dialog dismissed'
    );
  });
});
