/**
 * `console --follow --ndjson` prints one record per line: a `page` record
 * wherever the stream is on another page, a `message` record per message.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsoleMessage, PageNavigation } from '@/types.js';
import { createConsoleNdjson, formatConsoleFollowLines } from '@/ui/formatters/console.js';

const message = (text: string, navigationId: number): ConsoleMessage => ({
  type: 'log',
  text,
  timestamp: 1,
  navigationId,
});

const pages: PageNavigation[] = [
  { navigationId: 1, url: 'https://a.test/one' },
  { navigationId: 2, url: 'https://a.test/two' },
  { navigationId: 3, url: 'https://a.test/three' },
];

/** Records of lines as `type:id-or-text` */
const summary = (lines: string[]): string[] =>
  lines.map((line) => {
    const record = JSON.parse(line) as { type: string; navigationId?: number; text?: string };
    return `${record.type}:${record.type === 'page' ? record.navigationId : record.text}`;
  });

void describe('console ndjson stream', () => {
  void it('starts with the page record of the current page, before its messages', () => {
    const stream = createConsoleNdjson();
    const lines = stream.next([message('a', 3)], pages, 3);
    assert.deepEqual(summary(lines), ['page:3', 'message:a']);
    assert.deepEqual(JSON.parse(lines[0] as string), {
      type: 'page',
      navigationId: 3,
      url: 'https://a.test/three',
    });
  });

  void it('prints the current page record on a page without messages, and no empty record', () => {
    const stream = createConsoleNdjson();
    assert.deepEqual(summary(stream.next([], pages, 3)), ['page:3']);
    assert.deepEqual(stream.next([], pages, 3), []);
  });

  void it('gives a message the fields of console --json messages, its level as level (type tells the record kind)', () => {
    const stream = createConsoleNdjson();
    const withFrame: ConsoleMessage = {
      ...message('boom', 1),
      index: 4,
      stackTrace: [
        { url: 'https://a.test/x.js', lineNumber: 1, columnNumber: 2, functionName: 'f' },
      ],
    };
    const record = JSON.parse(stream.next([withFrame], pages, 1)[1] as string) as unknown;
    const { type: level, ...rest } = withFrame;
    assert.deepEqual(record, { type: 'message', level, ...rest });
  });

  void it('splits one poll batch of two pages with the page record between them', () => {
    const stream = createConsoleNdjson();
    stream.next([message('a', 1)], pages, 1);
    const lines = stream.next([message('b', 1), message('c', 2)], pages, 2);
    assert.deepEqual(summary(lines), ['message:b', 'page:2', 'message:c']);
  });

  void it('prints a page record for every navigation between two polls, also pages without messages', () => {
    const stream = createConsoleNdjson();
    stream.next([message('a', 1)], pages, 1);
    assert.deepEqual(summary(stream.next([message('d', 3)], pages, 3)), [
      'page:2',
      'page:3',
      'message:d',
    ]);
  });

  void it('prints a page record without url for a page the session has no record of', () => {
    const record: unknown = JSON.parse(
      createConsoleNdjson().next([message('q', 9)], pages, 9)[0] as string
    );
    assert.deepEqual(record, { type: 'page', navigationId: 9 });
  });

  void it('prints the page record of a page that logged nothing, once, at the end of the poll', () => {
    const stream = createConsoleNdjson();
    stream.next([message('a', 1)], pages, 1);
    assert.deepEqual(summary(stream.next([], pages, 2)), ['page:2']);
    assert.deepEqual(stream.next([], pages, 2), []);
  });

  void it('starts a --history backlog with the page of its first message', () => {
    const stream = createConsoleNdjson();
    const lines = stream.next([message('a', 1), message('b', 2)], pages, 2);
    assert.deepEqual(summary(lines), ['page:1', 'message:a', 'page:2', 'message:b']);
  });

  void it('shows page URLs as every output does: no credentials, tokens masked unless --include-sensitive', () => {
    const secret: PageNavigation[] = [
      {
        navigationId: 1,
        url: 'https://user:pw@a.test/p?token=hunter2secret&x=1#access_token=abc123',
      },
    ];
    const masked = createConsoleNdjson().next([], secret, 1).join('\n');
    assert.doesNotMatch(masked, /hunter2secret|abc123|user|pw@/);
    assert.match(masked, /a\.test\/p\?token=/);
    const shown = createConsoleNdjson({ includeSensitive: true }).next([], secret, 1).join('\n');
    assert.match(shown, /token=hunter2secret/);
    assert.doesNotMatch(shown, /user:pw@/);
  });
});

void describe('console follow separator', () => {
  void it('keeps a URL with a line break, escape or bidi override on the separator line', () => {
    const navigations = [{ navigationId: 2, url: 'https://a.test/p\nFAKE\u202e\u001b[2J' }];
    const text = formatConsoleFollowLines([], {
      streamNavigationId: 1,
      currentNavigationId: 2,
      navigations,
    });
    assert.equal(text.split('\n').length, 1, text);
    assert.ok(!text.includes('\u202e') && !text.includes(String.fromCharCode(27)), text);
  });

  void it('names the URL of the new page', () => {
    const text = formatConsoleFollowLines([message('left', 1), message('right', 2)], {
      streamNavigationId: 1,
      currentNavigationId: 2,
      navigations: pages,
    });
    assert.match(text, /── Next page: https:\/\/a\.test\/two \(navigation #2\) ──/);
  });

  void it('masks tokens of the URL unless --include-sensitive', () => {
    const navigations = [{ navigationId: 2, url: 'https://a.test/p?token=hunter2secret' }];
    const options = { streamNavigationId: 1, currentNavigationId: 2, navigations };
    assert.doesNotMatch(formatConsoleFollowLines([], options), /hunter2secret/);
    assert.match(
      formatConsoleFollowLines([], { ...options, includeSensitive: true }),
      /token=hunter2secret/
    );
  });
});

void describe('console text and ndjson streams', () => {
  void it('enter the same pages when several navigations passed between two polls', () => {
    const text = formatConsoleFollowLines([message('d', 3)], {
      streamNavigationId: 1,
      currentNavigationId: 3,
      navigations: pages,
    });
    const separators = [...text.matchAll(/\(navigation #(\d+)\)/g)].map((m) => Number(m[1]));
    const stream = createConsoleNdjson();
    stream.next([message('a', 1)], pages, 1);
    const records = stream
      .next([message('d', 3)], pages, 3)
      .map((line) => JSON.parse(line) as { type: string; navigationId?: number })
      .filter((record) => record.type === 'page');
    assert.deepEqual(separators, [2, 3]);
    assert.deepEqual(
      records.map((record) => record.navigationId),
      separators
    );
  });
});
