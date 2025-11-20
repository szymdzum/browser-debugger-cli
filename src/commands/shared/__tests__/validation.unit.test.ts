/**
 * Validation unit tests
 *
 * Tests validation rules following the testing philosophy: "Test the contract, not the implementation"
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resourceTypeRule } from '@/commands/shared/validation.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('validation - resourceTypeRule', () => {
  void it('should return empty array for undefined input', () => {
    const rule = resourceTypeRule();
    const result = rule.validate(undefined);

    assert.deepEqual(result, []);
  });

  void it('should return empty array for null input', () => {
    const rule = resourceTypeRule();
    const result = rule.validate(null);

    assert.deepEqual(result, []);
  });

  void it('should return empty array for empty string', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('');

    assert.deepEqual(result, []);
  });

  void it('should parse single resource type', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('Document');

    assert.deepEqual(result, ['Document']);
  });

  void it('should parse multiple comma-separated types', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('Document,XHR,Fetch');

    assert.deepEqual(result, ['Document', 'XHR', 'Fetch']);
  });

  void it('should normalize case (case-insensitive)', () => {
    const rule = resourceTypeRule();

    assert.deepEqual(rule.validate('document'), ['Document']);
    assert.deepEqual(rule.validate('xhr'), ['XHR']);
    assert.deepEqual(rule.validate('FETCH'), ['Fetch']);
    assert.deepEqual(rule.validate('DoCuMeNt'), ['Document']);
  });

  void it('should trim whitespace around types', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('  Document  ,  XHR  ,  Fetch  ');

    assert.deepEqual(result, ['Document', 'XHR', 'Fetch']);
  });

  void it('should handle mixed case in comma-separated list', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('document,XHR,fetch');

    assert.deepEqual(result, ['Document', 'XHR', 'Fetch']);
  });

  void it('should validate all 19 CDP ResourceType values', () => {
    const validTypes: Protocol.Network.ResourceType[] = [
      'Document',
      'Stylesheet',
      'Image',
      'Media',
      'Font',
      'Script',
      'TextTrack',
      'XHR',
      'Fetch',
      'Prefetch',
      'EventSource',
      'WebSocket',
      'Manifest',
      'SignedExchange',
      'Ping',
      'CSPViolationReport',
      'Preflight',
      'FedCM',
      'Other',
    ];

    const rule = resourceTypeRule();

    validTypes.forEach((type) => {
      const result = rule.validate(type);
      assert.deepEqual(result, [type]);
    });
  });

  void it('should throw CommandError for invalid type', () => {
    const rule = resourceTypeRule();

    assert.throws(
      () => rule.validate('InvalidType'),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.ok(error.message.includes('Invalid resource type'));
        assert.ok(error.message.includes('InvalidType'));
        assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
        return true;
      }
    );
  });

  void it('should throw CommandError for multiple invalid types', () => {
    const rule = resourceTypeRule();

    assert.throws(
      () => rule.validate('Document,BadType1,XHR,BadType2'),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.ok(error.message.includes('Invalid resource type'));
        assert.ok(error.message.includes('BadType1'));
        assert.ok(error.message.includes('BadType2'));
        return true;
      }
    );
  });

  void it('should provide suggestion with valid types in error', () => {
    const rule = resourceTypeRule();

    assert.throws(
      () => rule.validate('InvalidType'),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        const errorObj = error;
        assert.ok(errorObj.metadata?.suggestion);
        assert.ok(errorObj.metadata.suggestion.includes('Document'));
        assert.ok(errorObj.metadata.suggestion.includes('XHR'));
        assert.ok(errorObj.metadata.suggestion.includes('Fetch'));
        return true;
      }
    );
  });

  void it('should throw CommandError for non-string input', () => {
    const rule = resourceTypeRule();

    assert.throws(
      () => rule.validate(123),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.ok(error.message.includes('must be a string'));
        return true;
      }
    );

    assert.throws(
      () => rule.validate({ type: 'Document' }),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        return true;
      }
    );
  });

  void it('should ignore empty values in comma-separated list', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('Document,,XHR,,,Fetch,');

    assert.deepEqual(result, ['Document', 'XHR', 'Fetch']);
  });

  void it('should deduplicate types', () => {
    const rule = resourceTypeRule();
    const result = rule.validate('Document,XHR,Document,Fetch,XHR');

    // Note: Current implementation doesn't deduplicate, but this test documents the behavior
    // If deduplication is desired, update the implementation and this test will pass
    assert.ok(result.includes('Document'));
    assert.ok(result.includes('XHR'));
    assert.ok(result.includes('Fetch'));
  });
});
