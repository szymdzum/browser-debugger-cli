/**
 * A response longer than the client reads is replaced by an error reply with
 * the size, so the client never buffers it (#712).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_JSONL_BUFFER_SIZE } from '@/constants.js';
import { replyFrame } from '@/daemon/replyFrame.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const CAP = 1000;
const ENVELOPE = JSON.stringify({ value: '' }).length;

/**
 * A response whose line has exactly `chars` characters.
 *
 * @param chars - Characters of the line, without the newline
 * @param fill - Character repeated
 * @returns Response
 */
function responseOfLength(chars: number, fill = 'x'): { value: string } {
  return { value: fill.repeat(chars - ENVELOPE) };
}

const CASES: Array<{ name: string; chars: number; fill?: string; over: boolean }> = [
  { name: 'small', chars: 50, over: false },
  { name: 'exactly the cap', chars: CAP, over: false },
  { name: 'one over the cap', chars: CAP + 1, over: true },
  { name: 'far over the cap (a 300e6 reply, scaled)', chars: CAP * 3, over: true },
  { name: 'multibyte text counted in characters, not bytes', chars: CAP, fill: 'é', over: false },
  { name: 'multibyte text one character over', chars: CAP + 1, fill: 'é', over: true },
];

void describe('replyFrame', () => {
  for (const { name, chars, fill, over } of CASES) {
    void it(`${over ? 'refuses' : 'sends'} a response that is ${name}`, () => {
      const line = replyFrame(responseOfLength(chars, fill), 'cdp_call_request', CAP);
      assert.ok(line.endsWith('\n'));
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!over) {
        assert.equal(parsed['value'] !== undefined, true);
        return;
      }
      assert.equal(parsed['type'], 'error_response');
      assert.equal(parsed['exitCode'], EXIT_CODES.INVALID_ARGUMENTS);
      assert.match(String(parsed['error']), /over the .* limit/);
      assert.ok(line.length < 1000, 'the error reply is small');
    });
  }

  void it('names the size in MiB, one decimal, and tells a cdp call to return less', () => {
    const big = 300 * 1024 * 1024;
    const line = replyFrame({ value: 'x'.repeat(big) }, 'cdp_call_request', MAX_JSONL_BUFFER_SIZE);
    const parsed = JSON.parse(line) as { error: string; suggestion: string };
    assert.match(parsed.error, /300\.0 MiB/);
    assert.match(parsed.error, /256 MiB/);
    assert.match(parsed.suggestion, /returnByValue/);
  });

  void it('counts like the client buffer: the default cap is MAX_JSONL_BUFFER_SIZE', () => {
    const line = replyFrame({ value: 'x'.repeat(MAX_JSONL_BUFFER_SIZE) }, 'cdp_call_request');
    assert.equal((JSON.parse(line) as { type: string }).type, 'error_response');
  });
});
