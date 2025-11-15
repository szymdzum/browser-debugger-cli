/**
 * JSONL Protocol Unit Tests
 *
 * Tests JSONL parsing and formatting behavior.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSONLBuffer, parseJSONLFrame, toJSONLFrame } from '@/ipc/transport/jsonl.js';

void describe('JSONLBuffer', () => {
  void it('handles partial frames across chunks', () => {
    const buffer = new JSONLBuffer();

    const lines1 = buffer.process('{"foo":');
    assert.deepEqual(lines1, []);

    const lines2 = buffer.process('"bar"}\n');
    assert.deepEqual(lines2, ['{"foo":"bar"}']);
  });

  void it('processes multiple complete frames in one chunk', () => {
    const buffer = new JSONLBuffer();

    const lines = buffer.process('{"a":1}\n{"b":2}\n{"c":3}\n');
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  void it('filters out empty lines', () => {
    const buffer = new JSONLBuffer();

    const lines = buffer.process('{"a":1}\n\n{"b":2}\n   \n');
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  });

  void it('accumulates across multiple chunks', () => {
    const buffer = new JSONLBuffer();

    buffer.process('{"type":"status",');
    buffer.process('"sessionId":"123",');
    const lines = buffer.process('"status":"ok"}\n');

    assert.deepEqual(lines, ['{"type":"status","sessionId":"123","status":"ok"}']);
  });

  void it('clears buffer', () => {
    const buffer = new JSONLBuffer();

    buffer.process('{"incomplete":');
    buffer.clear();

    const lines = buffer.process('{"new":"message"}\n');
    assert.deepEqual(lines, ['{"new":"message"}']);
  });
});

void describe('parseJSONLFrame', () => {
  void it('parses valid JSON string', () => {
    const result = parseJSONLFrame<{ type: string; value: number }>('{"type":"test","value":42}');

    assert.equal(result.type, 'test');
    assert.equal(result.value, 42);
  });

  void it('throws on invalid JSON', () => {
    assert.throws(() => {
      parseJSONLFrame('{"invalid": json}');
    }, SyntaxError);
  });

  void it('handles complex nested objects', () => {
    const result = parseJSONLFrame<{ data: { nested: { value: string } } }>(
      '{"data":{"nested":{"value":"test"}}}'
    );

    assert.equal(result.data.nested.value, 'test');
  });
});

void describe('toJSONLFrame', () => {
  void it('always adds newline', () => {
    const inputs = [
      { type: 'status' },
      { type: 'peek', data: [] },
      { complex: { nested: { value: true } } },
    ];

    inputs.forEach((input) => {
      const result = toJSONLFrame(input);
      assert.ok(result.endsWith('\n'));
    });
  });

  void it('produces valid JSON', () => {
    const input = { type: 'status', sessionId: '123', value: 42 };
    const frame = toJSONLFrame(input);

    const parsed = JSON.parse(frame.trim()) as typeof input;
    assert.deepEqual(parsed, input);
  });

  void it('handles empty objects', () => {
    const result = toJSONLFrame({});
    assert.equal(result, '{}\n');
  });

  void it('handles arrays', () => {
    const result = toJSONLFrame([1, 2, 3]);
    assert.equal(result, '[1,2,3]\n');
  });
});
