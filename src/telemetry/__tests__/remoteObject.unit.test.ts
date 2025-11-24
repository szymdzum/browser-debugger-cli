import assert from 'node:assert';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { formatConsoleArgs, formatRemoteObject } from '@/telemetry/remoteObject.js';

void describe('remoteObject formatting', () => {
  void describe('formatRemoteObject', () => {
    void describe('primitives', () => {
      void it('formats string values', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'string',
          value: 'hello world',
        };
        assert.equal(formatRemoteObject(arg), 'hello world');
      });

      void it('formats number values', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'number',
          value: 42,
        };
        assert.equal(formatRemoteObject(arg), '42');
      });

      void it('formats boolean values', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'boolean',
          value: true,
        };
        assert.equal(formatRemoteObject(arg), 'true');
      });

      void it('formats null values', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          subtype: 'null',
          value: null,
        };
        assert.equal(formatRemoteObject(arg), 'null');
      });

      void it('formats undefined', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'undefined',
        };
        assert.equal(formatRemoteObject(arg), 'undefined');
      });
    });

    void describe('objects with preview', () => {
      void it('formats simple object preview', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          className: 'Object',
          preview: {
            type: 'object',
            overflow: false,
            properties: [
              { name: 'foo', type: 'string', value: 'bar' },
              { name: 'num', type: 'number', value: '123' },
            ],
          },
        };
        assert.equal(formatRemoteObject(arg), '{foo: "bar", num: 123}');
      });

      void it('formats array preview', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          subtype: 'array',
          preview: {
            type: 'object',
            subtype: 'array',
            overflow: false,
            properties: [
              { name: '0', type: 'number', value: '1' },
              { name: '1', type: 'number', value: '2' },
              { name: '2', type: 'number', value: '3' },
            ],
          },
        };
        assert.equal(formatRemoteObject(arg), '[1, 2, 3]');
      });

      void it('formats overflow indicator', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          className: 'Object',
          preview: {
            type: 'object',
            overflow: true,
            properties: [
              { name: 'a', type: 'number', value: '1' },
              { name: 'b', type: 'number', value: '2' },
            ],
          },
        };
        assert.equal(formatRemoteObject(arg), '{a: 1, b: 2, …}');
      });

      void it('formats nested object with valuePreview', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          className: 'Object',
          preview: {
            type: 'object',
            overflow: false,
            properties: [
              {
                name: 'user',
                type: 'object',
                valuePreview: {
                  type: 'object',
                  overflow: false,
                  properties: [
                    { name: 'name', type: 'string', value: 'John' },
                    { name: 'id', type: 'number', value: '123' },
                  ],
                },
              },
            ],
          },
        };
        assert.equal(formatRemoteObject(arg), '{user: {name: "John", id: 123}}');
      });

      void it('formats deeply nested objects', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          className: 'Object',
          preview: {
            type: 'object',
            overflow: false,
            properties: [
              {
                name: 'level1',
                type: 'object',
                valuePreview: {
                  type: 'object',
                  overflow: false,
                  properties: [
                    {
                      name: 'level2',
                      type: 'object',
                      valuePreview: {
                        type: 'object',
                        overflow: false,
                        properties: [{ name: 'value', type: 'string', value: 'deep' }],
                      },
                    },
                  ],
                },
              },
            ],
          },
        };
        assert.equal(formatRemoteObject(arg), '{level1: {level2: {value: "deep"}}}');
      });

      void it('formats nested array in object', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          className: 'Object',
          preview: {
            type: 'object',
            overflow: false,
            properties: [
              {
                name: 'items',
                type: 'object',
                subtype: 'array',
                valuePreview: {
                  type: 'object',
                  subtype: 'array',
                  overflow: false,
                  properties: [
                    { name: '0', type: 'number', value: '1' },
                    { name: '1', type: 'number', value: '2' },
                  ],
                },
              },
            ],
          },
        };
        assert.equal(formatRemoteObject(arg), '{items: [1, 2]}');
      });
    });

    void describe('special types', () => {
      void it('formats Date preview', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          subtype: 'date',
          description: 'Mon Nov 24 2025 12:00:00 GMT+0000',
          preview: {
            type: 'object',
            subtype: 'date',
            description: 'Mon Nov 24 2025 12:00:00 GMT+0000',
            overflow: false,
            properties: [],
          },
        };
        assert.equal(formatRemoteObject(arg), 'Mon Nov 24 2025 12:00:00 GMT+0000');
      });

      void it('formats RegExp preview', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          subtype: 'regexp',
          description: '/test/gi',
          preview: {
            type: 'object',
            subtype: 'regexp',
            description: '/test/gi',
            overflow: false,
            properties: [],
          },
        };
        assert.equal(formatRemoteObject(arg), '/test/gi');
      });

      void it('formats Error with description', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          subtype: 'error',
          description: 'Error: Something went wrong\n    at <anonymous>:1:1',
        };
        assert.equal(
          formatRemoteObject(arg),
          'Error: Something went wrong\n    at <anonymous>:1:1'
        );
      });
    });

    void describe('fallbacks', () => {
      void it('uses description when no preview available', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'object',
          className: 'CustomClass',
          description: 'CustomClass {}',
        };
        assert.equal(formatRemoteObject(arg), 'CustomClass {}');
      });

      void it('uses type when nothing else available', () => {
        const arg: Protocol.Runtime.RemoteObject = {
          type: 'function',
        };
        assert.equal(formatRemoteObject(arg), '[function]');
      });
    });
  });

  void describe('formatConsoleArgs', () => {
    void it('joins multiple arguments with spaces', () => {
      const args: Protocol.Runtime.RemoteObject[] = [
        { type: 'string', value: 'User:' },
        {
          type: 'object',
          preview: {
            type: 'object',
            overflow: false,
            properties: [{ name: 'name', type: 'string', value: 'John' }],
          },
        },
      ];
      assert.equal(formatConsoleArgs(args), 'User: {name: "John"}');
    });

    void it('handles mixed primitive and object arguments', () => {
      const args: Protocol.Runtime.RemoteObject[] = [
        { type: 'string', value: 'Count:' },
        { type: 'number', value: 42 },
        { type: 'boolean', value: true },
      ];
      assert.equal(formatConsoleArgs(args), 'Count: 42 true');
    });

    void it('handles empty args array', () => {
      assert.equal(formatConsoleArgs([]), '');
    });
  });
});
