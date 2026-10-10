/**
 * What a "not found" failure of an element command says about the page:
 * the daemon's note on every place selectors do not search gives way to the
 * note on what the checked page has, stays when the page was not checked,
 * and the original error comes back unchanged when the page cannot be read.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { noMatchContext } from '@/commands/dom/helpers/query.js';
import { notFoundSuggestion, runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import { unreachableElementsNote } from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-not-found-'));
const savedSessionDir = process.env['BDG_SESSION_DIR'];

before(() => {
  process.env['BDG_SESSION_DIR'] = sessionDir;
});
after(() => {
  if (savedSessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
  else process.env['BDG_SESSION_DIR'] = savedSessionDir;
  fs.rmSync(sessionDir, { recursive: true, force: true });
});

const SELECTOR = 'input[name=card-holder]';

/** The daemon's suggestion for `dom inspect`/`dom layout`: its line and the unchecked note */
const DAEMON_SUGGESTION = `Verify the CSS selector is correct.\n${unreachableElementsNote(SELECTOR)}`;

void describe('notFoundSuggestion', () => {
  void it("replaces the daemon's unchecked note with the note on what the page has", () => {
    const suggestion = notFoundSuggestion(DAEMON_SUGGESTION, SELECTOR, false, {
      unsearched: { crossOriginFrames: false, embeds: false, closedShadowHosts: ['x-vault'] },
    });
    assert.match(
      suggestion,
      /^Verify the CSS selector is correct\.\nThe page has closed shadow roots \(in <x-vault>\), which are not searched\.\nFor an element in a closed shadow root: bdg dom a11y query/
    );
    assert.doesNotMatch(suggestion, /eval --frame/);
  });

  void it('drops the unchecked note on a checked page with nothing selectors miss', () => {
    assert.equal(
      notFoundSuggestion(DAEMON_SUGGESTION, SELECTOR, false, {
        unsearched: { crossOriginFrames: false, embeds: false },
      }),
      'Verify the CSS selector is correct.'
    );
  });

  void it('keeps the unchecked note when the page was not checked', () => {
    assert.equal(notFoundSuggestion(DAEMON_SUGGESTION, SELECTOR, false, {}), DAEMON_SUGGESTION);
  });

  void it('adds the checked note after a page script that found nothing', () => {
    assert.equal(
      notFoundSuggestion(
        'Verify the selector matches a clickable element',
        'x-vault button',
        true,
        {
          unsearched: { crossOriginFrames: false, embeds: false, closedShadowHosts: ['x-vault'] },
        }
      ).split('\n')[1],
      'The page has closed shadow roots (in <x-vault>), which are not searched.'
    );
  });
});

void describe('not found without a page to read', () => {
  void it('noMatchContext names nothing when the page cannot be read', async () => {
    const context = await noMatchContext(SELECTOR);
    assert.equal(context.unsearched, undefined);
  });

  void it('runElementCommand returns the original 83 error', async () => {
    const result = await runElementCommand({
      selectorOrIndex: SELECTOR,
      index: undefined,
      buildRequest: (target: object) => target,
      command: 'inspect',
      action: 'inspect element',
      failureSuggestion: '',
      call: () =>
        Promise.resolve({
          status: 'error',
          error: `No nodes found matching "${SELECTOR}"`,
          exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
          suggestion: DAEMON_SUGGESTION,
        }),
    });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.equal(result.error, `No nodes found matching "${SELECTOR}"`);
    assert.equal(result.errorContext?.['suggestion'], DAEMON_SUGGESTION);
  });
});
