/**
 * Unit tests for preview formatter MIME type inference.
 *
 * Tests the contract of MIME type to resource type inference:
 * - Correct resource type inference from MIME patterns
 * - Pattern matching rule precedence
 * - Handling of undefined/null inputs
 * - Case-insensitive matching
 *
 * This enables refactoring the MIME_TYPE_RULES array without breaking tests.
 */

import assert from 'node:assert';
import { describe, test } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { formatPreview } from '@/ui/formatters/preview.js';

/**
 * Helper to test MIME type inference by checking abbreviations.
 * This tests the public contract without exposing private functions.
 */
function inferTypeFromMime(mimeType: string | undefined): string {
  const mockOutput = {
    version: '0.0.0',
    success: true,
    timestamp: new Date().toISOString(),
    duration: 0,
    target: { url: 'test', title: 'test' },
    data: {
      network: [
        {
          requestId: 'test-1',
          url: 'https://example.com/test',
          method: 'GET',
          timestamp: Date.now(),
          ...(mimeType !== undefined && { mimeType }),
        },
      ],
    },
  };

  const output = formatPreview(mockOutput, { json: false, last: 1 });
  const match = output.match(/\[([A-Z]{3})\]/);
  return match?.[1] ?? 'NONE';
}

describe('MIME type to resource type inference', () => {
  describe('Document type inference', () => {
    test('infers Document from text/html', () => {
      assert.strictEqual(inferTypeFromMime('text/html'), 'DOC');
    });

    test('infers Document from text/html with charset', () => {
      assert.strictEqual(inferTypeFromMime('text/html; charset=utf-8'), 'DOC');
    });

    test('infers Document from TEXT/HTML (case-insensitive)', () => {
      assert.strictEqual(inferTypeFromMime('TEXT/HTML'), 'DOC');
    });
  });

  describe('Stylesheet type inference', () => {
    test('infers Stylesheet from text/css', () => {
      assert.strictEqual(inferTypeFromMime('text/css'), 'CSS');
    });

    test('infers Stylesheet from text/css with charset', () => {
      assert.strictEqual(inferTypeFromMime('text/css; charset=utf-8'), 'CSS');
    });
  });

  describe('Script type inference', () => {
    test('infers Script from application/javascript', () => {
      assert.strictEqual(inferTypeFromMime('application/javascript'), 'SCR');
    });

    test('infers Script from text/javascript', () => {
      assert.strictEqual(inferTypeFromMime('text/javascript'), 'SCR');
    });

    test('infers Script from application/ecmascript', () => {
      assert.strictEqual(inferTypeFromMime('application/ecmascript'), 'SCR');
    });

    test('infers Script from application/x-javascript', () => {
      assert.strictEqual(inferTypeFromMime('application/x-javascript'), 'SCR');
    });
  });

  describe('Image type inference', () => {
    test('infers Image from image/png', () => {
      assert.strictEqual(inferTypeFromMime('image/png'), 'IMG');
    });

    test('infers Image from image/jpeg', () => {
      assert.strictEqual(inferTypeFromMime('image/jpeg'), 'IMG');
    });

    test('infers Image from image/svg+xml', () => {
      assert.strictEqual(inferTypeFromMime('image/svg+xml'), 'IMG');
    });

    test('infers Image from image/webp', () => {
      assert.strictEqual(inferTypeFromMime('image/webp'), 'IMG');
    });

    test('infers Image from IMAGE/PNG (case-insensitive)', () => {
      assert.strictEqual(inferTypeFromMime('IMAGE/PNG'), 'IMG');
    });
  });

  describe('Font type inference', () => {
    test('infers Font from font/woff2', () => {
      assert.strictEqual(inferTypeFromMime('font/woff2'), 'FNT');
    });

    test('infers Font from font/woff', () => {
      assert.strictEqual(inferTypeFromMime('font/woff'), 'FNT');
    });

    test('infers Font from application/font-woff', () => {
      assert.strictEqual(inferTypeFromMime('application/font-woff'), 'FNT');
    });
  });

  describe('Media type inference', () => {
    test('infers Media from video/mp4', () => {
      assert.strictEqual(inferTypeFromMime('video/mp4'), 'MED');
    });

    test('infers Media from audio/mpeg', () => {
      assert.strictEqual(inferTypeFromMime('audio/mpeg'), 'MED');
    });

    test('infers Media from video/webm', () => {
      assert.strictEqual(inferTypeFromMime('video/webm'), 'MED');
    });

    test('infers Media from audio/wav', () => {
      assert.strictEqual(inferTypeFromMime('audio/wav'), 'MED');
    });
  });

  describe('XHR type inference', () => {
    test('infers XHR from application/json', () => {
      assert.strictEqual(inferTypeFromMime('application/json'), 'XHR');
    });

    test('infers XHR from text/json', () => {
      assert.strictEqual(inferTypeFromMime('text/json'), 'XHR');
    });

    test('infers XHR from application/xml', () => {
      assert.strictEqual(inferTypeFromMime('application/xml'), 'XHR');
    });

    test('infers XHR from text/xml', () => {
      assert.strictEqual(inferTypeFromMime('text/xml'), 'XHR');
    });
  });

  describe('unknown MIME type handling', () => {
    test('returns OTH for unknown MIME type', () => {
      assert.strictEqual(inferTypeFromMime('application/octet-stream'), 'OTH');
    });

    test('returns OTH for custom MIME type', () => {
      assert.strictEqual(inferTypeFromMime('application/x-custom'), 'OTH');
    });

    test('returns OTH for undefined MIME type', () => {
      assert.strictEqual(inferTypeFromMime(undefined), 'OTH');
    });

    test('returns OTH for empty string MIME type', () => {
      assert.strictEqual(inferTypeFromMime(''), 'OTH');
    });
  });

  describe('pattern matching precedence', () => {
    test('prioritizes first matching rule', () => {
      assert.strictEqual(inferTypeFromMime('text/html'), 'DOC');
    });

    test('handles MIME types with multiple potential matches', () => {
      assert.strictEqual(inferTypeFromMime('application/json+xml'), 'XHR');
    });
  });

  describe('resourceType takes precedence over MIME inference', () => {
    test('uses CDP resourceType when available', () => {
      const mockOutput = {
        version: '0.0.0',
        success: true,
        timestamp: new Date().toISOString(),
        duration: 0,
        target: { url: 'test', title: 'test' },
        data: {
          network: [
            {
              requestId: 'test-1',
              url: 'https://example.com/test.js',
              method: 'GET',
              timestamp: Date.now(),
              mimeType: 'text/html',
              resourceType: 'Script' as Protocol.Network.ResourceType,
            },
          ],
        },
      };

      const output = formatPreview(mockOutput, { json: false, last: 1 });

      assert.ok(output.includes('[SCR]'));
    });
  });
});
