/**
 * Unit tests for JsonlParser
 *
 * Tests the contract: parse streaming JSONL data, handling partial messages across chunks.
 * Focus on edge cases: split messages, empty lines, malformed JSON.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { JsonlParser } from '@/daemon/server/JsonlParser.js';
import { createLogger } from '@/ui/logging/index.js';

const mockLogger = createLogger('ipc');

void describe('JsonlParser', () => {
  let parser: JsonlParser;

  beforeEach(() => {
    parser = new JsonlParser(mockLogger);
  });

  void describe('complete messages', () => {
    void it('parses single complete message', () => {
      const chunk = Buffer.from('{"foo":"bar"}\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, [{ foo: 'bar' }]);
    });

    void it('parses multiple complete messages', () => {
      const chunk = Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, [{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    void it('handles complex nested objects', () => {
      const chunk = Buffer.from('{"data":{"nested":{"value":42},"array":[1,2,3]}}\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, [
        {
          data: {
            nested: { value: 42 },
            array: [1, 2, 3],
          },
        },
      ]);
    });
  });

  void describe('partial messages across chunks', () => {
    void it('buffers incomplete message until next chunk', () => {
      const chunk1 = Buffer.from('{"foo":');
      const chunk2 = Buffer.from('"bar"}\n');

      const result1 = parser.parse(chunk1);
      const result2 = parser.parse(chunk2);

      assert.deepEqual(result1, []);
      assert.deepEqual(result2, [{ foo: 'bar' }]);
    });

    void it('handles message split across three chunks', () => {
      const chunk1 = Buffer.from('{"a":');
      const chunk2 = Buffer.from('1,"b":');
      const chunk3 = Buffer.from('2}\n');

      assert.deepEqual(parser.parse(chunk1), []);
      assert.deepEqual(parser.parse(chunk2), []);
      assert.deepEqual(parser.parse(chunk3), [{ a: 1, b: 2 }]);
    });

    void it('handles complete message followed by partial', () => {
      const chunk1 = Buffer.from('{"first":"complete"}\n{"second":');
      const chunk2 = Buffer.from('"partial"}\n');

      const result1 = parser.parse(chunk1);
      const result2 = parser.parse(chunk2);

      assert.deepEqual(result1, [{ first: 'complete' }]);
      assert.deepEqual(result2, [{ second: 'partial' }]);
    });
  });

  void describe('edge cases', () => {
    void it('skips empty lines', () => {
      const chunk = Buffer.from('{"a":1}\n\n{"b":2}\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
    });

    void it('skips whitespace-only lines', () => {
      const chunk = Buffer.from('{"a":1}\n   \n{"b":2}\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
    });

    void it('handles empty buffer', () => {
      const chunk = Buffer.from('');
      const result = parser.parse(chunk);

      assert.deepEqual(result, []);
    });

    void it('handles buffer with only newlines', () => {
      const chunk = Buffer.from('\n\n\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, []);
    });
  });

  void describe('malformed JSON', () => {
    void it('skips invalid JSON and continues parsing', () => {
      const chunk = Buffer.from('{"valid":1}\ninvalid json\n{"valid":2}\n');
      const result = parser.parse(chunk);

      // Should parse valid messages, skip invalid
      assert.deepEqual(result, [{ valid: 1 }, { valid: 2 }]);
    });

    void it('handles malformed JSON without crashing', () => {
      const chunk = Buffer.from('{broken\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, []);
    });
  });

  void describe('buffer management', () => {
    void it('exposes current buffer content', () => {
      const chunk = Buffer.from('{"incomplete":');
      parser.parse(chunk);

      assert.equal(parser.getBuffer(), '{"incomplete":');
    });

    void it('clears buffer on demand', () => {
      parser.parse(Buffer.from('{"incomplete":'));
      assert.ok(parser.getBuffer().length > 0);

      parser.clear();
      assert.equal(parser.getBuffer(), '');
    });

    void it('maintains buffer across multiple chunks', () => {
      parser.parse(Buffer.from('{"a":'));
      assert.equal(parser.getBuffer(), '{"a":');

      parser.parse(Buffer.from('1,"b":'));
      assert.equal(parser.getBuffer(), '{"a":1,"b":');

      parser.parse(Buffer.from('2}\n'));
      assert.equal(parser.getBuffer(), '');
    });
  });

  void describe('UTF-8 handling', () => {
    void it('handles UTF-8 characters correctly', () => {
      const chunk = Buffer.from('{"emoji":"🎉","text":"Hello 世界"}\n');
      const result = parser.parse(chunk);

      assert.deepEqual(result, [{ emoji: '🎉', text: 'Hello 世界' }]);
    });

    void it('handles multi-byte UTF-8 split across chunks', () => {
      const message = '{"text":"🎉"}\n';
      const buffer = Buffer.from(message);
      const mid = Math.floor(buffer.length / 2);

      const chunk1 = buffer.subarray(0, mid);
      const chunk2 = buffer.subarray(mid);

      assert.deepEqual(parser.parse(chunk1), []);
      assert.deepEqual(parser.parse(chunk2), [{ text: '🎉' }]);
    });
  });
});
