/**
 * Schema contract tests
 *
 * These tests lock the JSON schema shape to prevent breaking changes.
 * Golden files define the expected structure that consumers depend on.
 *
 * Test philosophy:
 * - Ensure all required fields are present with correct types
 * - Detect unexpected fields (potential breaking changes)
 * - Validate nested structure matches interface definitions
 * - Test both success and error output formats
 *
 * When tests fail:
 * 1. If adding optional fields → Update golden file, bump minor version
 * 2. If changing existing fields → This is a BREAKING CHANGE, requires major version bump
 * 3. If removing fields → This is a BREAKING CHANGE, requires major version bump
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { BdgOutput, NetworkRequest, ConsoleMessage } from '@/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load golden file from fixtures directory
 */
function loadGoldenFile(filename: string): BdgOutput {
  const goldenPath = path.join(__dirname, 'fixtures', filename);
  const content = fs.readFileSync(goldenPath, 'utf-8');
  return JSON.parse(content) as BdgOutput;
}

describe('BdgOutput schema contract', () => {
  describe('v0.2.1 schema', () => {
    let golden: BdgOutput;

    it('should load golden file successfully', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');
      assert.ok(golden, 'Golden file should load');
    });

    it('should have all required top-level fields', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      // Required fields
      assert.equal(typeof golden.version, 'string', 'version must be string');
      assert.equal(typeof golden.success, 'boolean', 'success must be boolean');
      assert.equal(typeof golden.timestamp, 'string', 'timestamp must be string');
      assert.equal(typeof golden.duration, 'number', 'duration must be number');
      assert.ok(golden.target, 'target must be present');
      assert.ok(golden.data, 'data must be present');

      // Validate ISO8601 timestamp format
      assert.ok(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(golden.timestamp),
        'timestamp must be ISO8601 format'
      );
    });

    it('should have target structure with url and title', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      assert.equal(typeof golden.target.url, 'string', 'target.url must be string');
      assert.equal(typeof golden.target.title, 'string', 'target.title must be string');

      // Should not have extra fields
      const targetKeys = Object.keys(golden.target);
      assert.deepEqual(
        targetKeys.sort(),
        ['title', 'url'].sort(),
        'target should only have url and title'
      );
    });

    it('should have data object with optional telemetry arrays', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      assert.equal(typeof golden.data, 'object', 'data must be object');

      // Validate network array if present
      if (golden.data.network !== undefined) {
        assert.ok(Array.isArray(golden.data.network), 'data.network must be array');
      }

      // Validate console array if present
      if (golden.data.console !== undefined) {
        assert.ok(Array.isArray(golden.data.console), 'data.console must be array');
      }

      // Validate dom object if present
      if (golden.data.dom !== undefined) {
        assert.equal(typeof golden.data.dom, 'object', 'data.dom must be object');
      }

      // Should only have known telemetry types
      const dataKeys = Object.keys(golden.data);
      const allowedKeys = ['network', 'console', 'dom'];
      for (const key of dataKeys) {
        assert.ok(
          allowedKeys.includes(key),
          `data.${key} is not a known telemetry type. Allowed: ${allowedKeys.join(', ')}`
        );
      }
    });

    it('should validate NetworkRequest structure', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      if (!golden.data.network || golden.data.network.length === 0) {
        assert.fail('Golden file must have at least one network request for validation');
      }

      const request = golden.data.network[0] as NetworkRequest;

      // Required fields
      assert.equal(typeof request.requestId, 'string', 'requestId must be string');
      assert.equal(typeof request.url, 'string', 'url must be string');
      assert.equal(typeof request.method, 'string', 'method must be string');
      assert.equal(typeof request.timestamp, 'number', 'timestamp must be number');

      // Optional fields with type validation
      if (request.status !== undefined) {
        assert.equal(typeof request.status, 'number', 'status must be number if present');
      }
      if (request.mimeType !== undefined) {
        assert.equal(typeof request.mimeType, 'string', 'mimeType must be string if present');
      }
      if (request.requestHeaders !== undefined) {
        assert.equal(
          typeof request.requestHeaders,
          'object',
          'requestHeaders must be object if present'
        );
      }
      if (request.responseHeaders !== undefined) {
        assert.equal(
          typeof request.responseHeaders,
          'object',
          'responseHeaders must be object if present'
        );
      }
      if (request.requestBody !== undefined) {
        assert.equal(typeof request.requestBody, 'string', 'requestBody must be string if present');
      }
      if (request.responseBody !== undefined) {
        assert.equal(
          typeof request.responseBody,
          'string',
          'responseBody must be string if present'
        );
      }

      // Validate no unexpected fields
      const allowedKeys = [
        'requestId',
        'url',
        'method',
        'timestamp',
        'status',
        'mimeType',
        'requestHeaders',
        'responseHeaders',
        'requestBody',
        'responseBody',
      ];
      const requestKeys = Object.keys(request);
      for (const key of requestKeys) {
        assert.ok(
          allowedKeys.includes(key),
          `NetworkRequest.${key} is not in schema. Allowed: ${allowedKeys.join(', ')}`
        );
      }
    });

    it('should validate ConsoleMessage structure', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      if (!golden.data.console || golden.data.console.length === 0) {
        assert.fail('Golden file must have at least one console message for validation');
      }

      const message = golden.data.console[0] as ConsoleMessage;

      // Required fields
      assert.equal(typeof message.type, 'string', 'type must be string');
      assert.equal(typeof message.text, 'string', 'text must be string');
      assert.equal(typeof message.timestamp, 'number', 'timestamp must be number');

      // Optional fields
      if (message.args !== undefined) {
        assert.ok(Array.isArray(message.args), 'args must be array if present');
      }

      // Validate no unexpected fields
      const allowedKeys = ['type', 'text', 'timestamp', 'args'];
      const messageKeys = Object.keys(message);
      for (const key of messageKeys) {
        assert.ok(
          allowedKeys.includes(key),
          `ConsoleMessage.${key} is not in schema. Allowed: ${allowedKeys.join(', ')}`
        );
      }
    });

    it('should validate DOMData structure', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      if (!golden.data.dom) {
        assert.fail('Golden file must have dom data for validation');
      }

      const dom = golden.data.dom;

      // Required fields
      assert.equal(typeof dom.url, 'string', 'url must be string');
      assert.equal(typeof dom.title, 'string', 'title must be string');
      assert.equal(typeof dom.outerHTML, 'string', 'outerHTML must be string');

      // Validate no unexpected fields
      const allowedKeys = ['url', 'title', 'outerHTML'];
      const domKeys = Object.keys(dom);
      for (const key of domKeys) {
        assert.ok(
          allowedKeys.includes(key),
          `DOMData.${key} is not in schema. Allowed: ${allowedKeys.join(', ')}`
        );
      }
    });

    it('should validate optional error field', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      // Error field is optional
      if (golden.error !== undefined) {
        assert.equal(typeof golden.error, 'string', 'error must be string if present');
      }
    });

    it('should validate optional partial field', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      // Partial field is optional
      if (golden.partial !== undefined) {
        assert.equal(typeof golden.partial, 'boolean', 'partial must be boolean if present');
      }
    });

    it('should detect unexpected top-level fields', () => {
      golden = loadGoldenFile('schema-v0.2.1.golden.json');

      const allowedTopLevelKeys = [
        'version',
        'success',
        'timestamp',
        'duration',
        'target',
        'data',
        'error',
        'partial',
      ];

      const actualKeys = Object.keys(golden);
      for (const key of actualKeys) {
        assert.ok(
          allowedTopLevelKeys.includes(key),
          `Unexpected top-level field: ${key}. This may be a breaking change.`
        );
      }
    });
  });

  describe('Error output format', () => {
    it('should have success=false and error field on failure', () => {
      const errorOutput: BdgOutput = {
        version: '0.2.1',
        success: false,
        timestamp: new Date().toISOString(),
        duration: 1000,
        target: { url: '', title: '' },
        data: {},
        error: 'Connection failed',
      };

      assert.equal(errorOutput.success, false, 'success must be false on error');
      assert.equal(typeof errorOutput.error, 'string', 'error must be string');
      assert.ok(errorOutput.error !== undefined, 'error must be defined');
      assert.ok(errorOutput.error.length > 0, 'error message must not be empty');
    });
  });

  describe('Partial output format', () => {
    it('should have partial=true for live previews', () => {
      const previewOutput: BdgOutput = {
        version: '0.2.1',
        success: true,
        timestamp: new Date().toISOString(),
        duration: 1000,
        target: { url: 'https://example.com', title: 'Example' },
        data: {
          network: [],
          console: [],
        },
        partial: true,
      };

      assert.equal(previewOutput.partial, true, 'partial must be true for live previews');
      assert.equal(previewOutput.success, true, 'success can be true with partial=true');
    });
  });
});
