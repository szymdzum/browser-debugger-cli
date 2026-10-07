/**
 * Long single values (#440): human output cuts them with a pointer naming
 * `--full`, JSON console texts and eval strings carry `truncatedFrom`, and
 * `--full` gives the whole value back.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_CONSOLE_JSON_TEXT_LENGTH,
  MAX_CONSOLE_TEXT_LENGTH,
  MAX_VALUE_LENGTH,
} from '@/constants.js';
import type { BdgOutput, ConsoleMessage } from '@/types.js';
import {
  buildConsoleJsonOutput,
  formatConsole,
  formatConsoleFollowLines,
} from '@/ui/formatters/console.js';
import { formatDomEval, formatDomGet } from '@/ui/formatters/dom.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import { buildPreviewJsonData, formatPreview } from '@/ui/formatters/preview.js';
import { capLength } from '@/utils/strings.js';

const LOGGED = 'L'.repeat(500_000);
const THROWN = `Error: ${'E'.repeat(100_000)}`;

const messages: ConsoleMessage[] = [
  { type: 'log', text: LOGGED, timestamp: 1000, index: 0 },
  { type: 'error', text: THROWN, timestamp: 1001, index: 1 },
];

/**
 * A preview holding the long messages.
 *
 * @returns Preview output
 */
function preview(): BdgOutput {
  return {
    version: '0.0.0',
    success: true,
    timestamp: new Date(0).toISOString(),
    duration: 1000,
    target: { url: 'http://localhost/', title: 'caps' },
    data: { console: messages },
  };
}

/**
 * Longest line of a text.
 *
 * @param text - Output
 * @returns Its length
 */
function longestLine(text: string): number {
  return Math.max(...text.split('\n').map((line) => line.length));
}

void describe('capLength', () => {
  void it('keeps a short text and cuts a long one, saying how long it was', () => {
    assert.deepEqual(capLength('abc', 3), { text: 'abc' });
    assert.deepEqual(capLength('abcdef', 3), { text: 'abc', truncatedFrom: 6 });
  });
});

void describe('capForDisplay', () => {
  void it('appends how many characters were left out and names --full', () => {
    assert.equal(capForDisplay('abcdef', 3), 'abc… 3 more chars (use --full)');
    assert.equal(capForDisplay('abc', 3), 'abc');
    assert.equal(capForDisplay('abcdef', 3, true), 'abcdef');
  });
});

void describe('console messages in human output', () => {
  const listed = formatConsole(messages, { list: true, last: 0 });

  void it('cut in --list, with the pointer', () => {
    assert.match(listed, /L… 499800 more chars \(use --full\)/);
    assert.ok(listed.length < 1000, `list is ${listed.length} chars`);
  });

  void it('cut in the summary no longer than in --list', () => {
    const summary = formatConsole(messages, {});
    assert.ok(longestLine(summary) <= longestLine(listed), 'summary line longer than --list');
    assert.match(summary, new RegExp(`… ${THROWN.length - MAX_CONSOLE_TEXT_LENGTH} more chars`));
  });

  void it('cut in peek, compact and verbose, no longer than in --list', () => {
    for (const verbose of [false, true]) {
      const text = formatPreview(preview(), { last: 0, verbose });
      assert.ok(longestLine(text) <= longestLine(listed), `peek verbose=${verbose}: too long`);
      assert.match(text, /more chars \(use --full\)/);
    }
  });

  void it('cut in console --follow lines', () => {
    const text = formatConsoleFollowLines(messages);
    assert.ok(longestLine(text) <= longestLine(listed), 'follow line longer than --list');
  });

  void it('given in full with --full', () => {
    assert.ok(formatConsole(messages, { full: true }).includes(THROWN));
    assert.ok(formatConsole(messages, { list: true, last: 0, full: true }).includes(LOGGED));
    assert.ok(formatPreview(preview(), { last: 0, full: true }).includes(LOGGED));
    assert.ok(formatPreview(preview(), { last: 0, verbose: true, full: true }).includes(THROWN));
    assert.ok(formatConsoleFollowLines(messages, { full: true }).includes(LOGGED));
  });
});

void describe('console messages in JSON', () => {
  void it('texts over the cap are cut with truncatedFrom', () => {
    const output = buildConsoleJsonOutput(messages, { list: true, last: 0 });
    const [logged, thrown] = output.messages ?? [];
    assert.equal(logged?.text.length, MAX_CONSOLE_JSON_TEXT_LENGTH);
    assert.equal(logged?.truncatedFrom, LOGGED.length);
    assert.equal(thrown?.truncatedFrom, THROWN.length);
    assert.equal(output.errors[0]?.text.length, MAX_CONSOLE_JSON_TEXT_LENGTH);
    assert.equal(output.errors[0]?.truncatedFrom, THROWN.length);
  });

  void it('short texts carry no truncatedFrom', () => {
    const output = buildConsoleJsonOutput([{ type: 'error', text: 'short', timestamp: 1 }], {
      list: true,
    });
    assert.equal(output.messages?.[0]?.truncatedFrom, undefined);
    assert.equal(output.errors[0]?.truncatedFrom, undefined);
  });

  void it('peek --json cuts them the same way', () => {
    const data = buildPreviewJsonData(preview(), { last: 0 });
    assert.equal(data.console?.[0]?.text.length, MAX_CONSOLE_JSON_TEXT_LENGTH);
    assert.equal(data.console?.[0]?.truncatedFrom, LOGGED.length);
  });

  void it('--full keeps them whole', () => {
    const output = buildConsoleJsonOutput(messages, { list: true, last: 0, full: true });
    assert.equal(output.messages?.[0]?.text, LOGGED);
    assert.equal(output.errors[0]?.text, THROWN);
    assert.equal(
      buildPreviewJsonData(preview(), { last: 0, full: true }).console?.[0]?.text,
      LOGGED
    );
  });
});

void describe('dom get --raw and dom eval human output', () => {
  const html = `<body>${'D'.repeat(3_000_000)}</body>`;

  void it('dom get --raw prints the cap and a pointer naming --full', () => {
    const output = formatDomGet({ nodes: [{ nodeId: 1, outerHTML: html }] });
    assert.ok(output.startsWith(html.slice(0, MAX_VALUE_LENGTH)));
    assert.ok(output.endsWith(`… ${html.length - MAX_VALUE_LENGTH} more chars (use --full)`));
    const all = formatDomGet({
      nodes: [
        { nodeId: 1, outerHTML: html },
        { nodeId: 2, outerHTML: html },
      ],
    });
    assert.ok(all.length < 3 * MAX_VALUE_LENGTH, `--all is ${all.length} chars`);
  });

  void it('dom eval prints the cap and a pointer naming --full', () => {
    const output = formatDomEval({ result: html, type: 'string' });
    assert.ok(output.length < MAX_VALUE_LENGTH + 100, `eval is ${output.length} chars`);
    assert.match(output, /more chars \(use --full\)$/);
    const object = formatDomEval({ result: { html }, type: 'object' });
    assert.ok(object.length < MAX_VALUE_LENGTH + 100, `object eval is ${object.length} chars`);
  });

  void it('--full prints the value byte for byte', () => {
    assert.equal(formatDomGet({ nodes: [{ nodeId: 1, outerHTML: html }] }, { full: true }), html);
    assert.equal(formatDomEval({ result: html, type: 'string' }, { full: true }), html);
  });
});
