/**
 * `dom eval --frame` picks one iframe by index, name/id attribute or a part
 * of the name, id or URL,
 * and fails with the candidates (81) or the available frames (83) otherwise.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError } from '@/errors/index.js';
import type { DomFrame } from '@/ipc/protocol/commands.js';
import { assertFrameIndexCurrent, selectFrame } from '@/runtime/dom/frameSelection.js';
import { iframesInOrder } from '@/runtime/dom/frames.js';
import { formatDomEval, formatDomFrames } from '@/ui/formatters/dom.js';
import { evalFrameLine } from '@/ui/messages/commands.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const FRAMES: DomFrame[] = [
  {
    index: 0,
    url: 'http://localhost:3000/widget',
    name: 'widget',
    origin: 'http://localhost:3000',
    crossOrigin: false,
    outOfProcess: false,
  },
  {
    index: 1,
    url: 'https://pay.example/checkout',
    id: 'checkout',
    origin: 'https://pay.example',
    crossOrigin: true,
    outOfProcess: true,
  },
  {
    index: 2,
    url: 'https://ads.example/slot?checkout=1',
    origin: 'https://ads.example',
    crossOrigin: true,
    outOfProcess: true,
  },
];

/**
 * The CommandError thrown by `selectFrame`.
 *
 * @param query - Requested frame
 * @param frames - Frames of the page
 * @returns The error
 */
function selectionError(query: string, frames: DomFrame[] = FRAMES): CommandError {
  try {
    selectFrame(frames, query);
  } catch (error) {
    assert.ok(error instanceof CommandError);
    return error;
  }
  assert.fail(`"${query}" unexpectedly matched a frame`);
}

void describe('selectFrame', () => {
  void it('picks a frame by 0-based index', () => {
    assert.equal(selectFrame(FRAMES, '1').index, 1);
    assert.equal(selectFrame(FRAMES, ' 0 ').index, 0);
  });

  void it('picks a frame by exact name or id attribute before URL parts', () => {
    assert.equal(selectFrame(FRAMES, 'widget').index, 0);
    assert.equal(selectFrame(FRAMES, 'checkout').index, 1);
  });

  void it('picks a frame by a case-insensitive part of the URL', () => {
    assert.equal(selectFrame(FRAMES, 'PAY.example').index, 1);
    assert.equal(selectFrame(FRAMES, 'slot').index, 2);
  });

  void it('picks a frame by a case-insensitive part of the name or id', () => {
    assert.equal(selectFrame(FRAMES, 'WIDG').index, 0);
    const editor: DomFrame = {
      index: 3,
      url: 'about:blank',
      id: 'mce_0_ifr',
      origin: 'http://localhost:3000',
      crossOrigin: false,
      outOfProcess: false,
    };
    assert.equal(selectFrame([...FRAMES, editor], 'mce').index, 3);
    assert.equal(selectionError('check').exitCode, EXIT_CODES.INVALID_ARGUMENTS);
  });

  void it('fails with 81 listing the candidates when several frames match', () => {
    const error = selectionError('example');
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(error.message, /matches 2 frames/);
    const suggestion = String(error.metadata['suggestion']);
    assert.match(suggestion, /\[1\] https:\/\/pay\.example\/checkout/);
    assert.match(suggestion, /\[2\] https:\/\/ads\.example/);
    assert.doesNotMatch(suggestion, /\[0\]/);
  });

  void it('fails with 83 listing all frames when nothing matches', () => {
    for (const query of ['nope', '3']) {
      const error = selectionError(query);
      assert.equal(error.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
      assert.match(error.message, new RegExp(`Frame not found: ${query}`));
      assert.match(String(error.metadata['suggestion']), /\[0\].*\n.*\[1\].*\n.*\[2\]/);
    }
  });

  void it('says when the page has no iframes', () => {
    const error = selectionError('0', []);
    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(String(error.metadata['suggestion']), /no iframes/);
  });

  void it('rejects an empty frame with 81', () => {
    assert.equal(selectionError('  ').exitCode, EXIT_CODES.INVALID_ARGUMENTS);
  });
});

void describe('frame output', () => {
  void it('lists frames with their names and isolation', () => {
    assert.equal(
      formatDomFrames({ frames: FRAMES.slice(0, 2) }),
      '[0] http://localhost:3000/widget  name=widget  same-origin\n' +
        '[1] https://pay.example/checkout  #checkout  cross-origin, out-of-process'
    );
    assert.equal(formatDomFrames({ frames: [] }), 'The page has no iframes');
  });

  void it('says the list may be incomplete while the page is still loading', () => {
    assert.equal(
      formatDomFrames({ frames: [], readyState: 'loading' }),
      'No iframes yet; the page is still loading, so the list may be incomplete (bdg dom wait --load)'
    );
    const listed = formatDomFrames({ frames: FRAMES.slice(0, 1), readyState: 'interactive' });
    assert.match(listed, /^\[0\] http:\/\/localhost:3000\/widget/);
    assert.match(
      listed,
      /\nNote: the page is still loading, so the list may be incomplete \(bdg dom wait --load\)$/
    );
    assert.doesNotMatch(
      formatDomFrames({ frames: FRAMES.slice(0, 1), readyState: 'complete' }),
      /still loading/
    );
  });

  void it('indents nested frames, shortens long URLs and names empty ones', () => {
    const longUrl = `https://embed.example/?q=${'x'.repeat(200)}`;
    const nested: DomFrame[] = [
      { ...(FRAMES[1] as DomFrame), index: 0 },
      { index: 1, url: '', origin: 'null', crossOrigin: true, outOfProcess: true, parentIndex: 0 },
      {
        index: 2,
        url: longUrl,
        origin: 'x',
        crossOrigin: true,
        outOfProcess: true,
        parentIndex: 1,
      },
    ];
    const [first, second, third] = formatDomFrames({ frames: nested }).split('\n');
    assert.match(first ?? '', /^\[0\] https:\/\/pay/);
    assert.equal(second, '  [1] (no URL)  cross-origin, out-of-process');
    assert.match(third ?? '', /^ {4}\[2\] https:\/\/embed\.example\/\?q=x+… {2}cross-origin/);
    assert.ok((third ?? '').length < 150);
  });

  void it('prints the eval value alone (the frame goes to stderr)', () => {
    assert.equal(formatDomEval({ result: 'Pay', type: 'string' }), 'Pay');
    assert.equal(evalFrameLine('https://pay.example/'), 'Frame: https://pay.example/');
    assert.equal(evalFrameLine(''), 'Frame: (no URL)');
  });
});

void describe('frame indices', () => {
  /**
   * A frame tree node.
   *
   * @param id - Frame id
   * @param parentId - Parent frame id
   * @returns Node with a frame
   */
  const node = (id: string, parentId: string): { frame: { id: string; parentId: string } } => ({
    frame: { id, parentId },
  });

  void it('lists siblings in document order, depth-first, unplaced ones last', () => {
    const nodes = [
      node('a', 'main'),
      node('c', 'main'),
      node('a1', 'a'),
      node('a2', 'a'),
      node('late', 'main'),
      node('oopif', 'main'),
    ];
    const rank = new Map([
      ['oopif', 0],
      ['a', 1],
      ['c', 2],
      ['a2', 0],
      ['a1', 1],
    ]);
    const ordered = iframesInOrder(nodes as never[], 'main', rank) as typeof nodes;
    assert.deepEqual(
      ordered.map((n) => n.frame.id),
      ['oopif', 'a', 'a2', 'a1', 'c', 'late']
    );
  });

  void it('fails with 87 when an index names another frame than when listed', () => {
    const stale = (query: string, current: string[], listed?: string[]): number | undefined => {
      try {
        assertFrameIndexCurrent(query, current, listed);
        return undefined;
      } catch (error) {
        assert.ok(error instanceof CommandError);
        assert.match(error.message, /Frame index \d+ is stale/);
        assert.match(String(error.metadata['suggestion']), /Re-run bdg dom frames/);
        return error.exitCode;
      }
    };
    assert.equal(stale('0', ['a', 'b'], ['a', 'b']), undefined);
    assert.equal(stale('0', ['new', 'a', 'b'], ['a', 'b']), EXIT_CODES.STALE_CACHE);
    assert.equal(stale(' 1 ', ['a'], ['a', 'b']), EXIT_CODES.STALE_CACHE);
    assert.equal(stale('2', ['a', 'b', 'c'], ['a', 'b']), EXIT_CODES.STALE_CACHE);
    assert.equal(stale('5', ['a', 'b'], ['a', 'b']), undefined, 'out of range is "not found"');
    assert.equal(stale('0', ['new'], undefined), undefined, 'never listed');
    assert.equal(stale('widget', ['new'], ['a']), undefined, 'names are resolved afresh');
  });
});
