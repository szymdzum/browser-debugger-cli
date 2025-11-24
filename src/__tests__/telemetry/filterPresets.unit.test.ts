/**
 * Filter presets unit tests.
 *
 * Tests the contract of preset resolution:
 * - Known presets resolve to valid filter strings
 * - Unknown presets throw with helpful error messages
 * - Preset names list is complete
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateFilterString } from '@/telemetry/filterDsl.js';
import { FILTER_PRESETS, resolvePreset, getPresetNames } from '@/telemetry/filterPresets.js';

describe('Filter presets', () => {
  describe('FILTER_PRESETS', () => {
    it('has all documented presets', () => {
      const expectedPresets = [
        'errors',
        'api',
        'large',
        'cached',
        'documents',
        'media',
        'scripts',
        'pending',
      ];

      for (const name of expectedPresets) {
        assert.ok(FILTER_PRESETS[name], `Preset "${name}" should exist`);
      }
    });

    it('each preset has required fields', () => {
      for (const [name, preset] of Object.entries(FILTER_PRESETS)) {
        assert.equal(typeof preset.name, 'string', `${name}.name must be string`);
        assert.equal(typeof preset.description, 'string', `${name}.description must be string`);
        assert.equal(typeof preset.filter, 'string', `${name}.filter must be string`);
        assert.ok(preset.description.length > 0, `${name}.description must not be empty`);
        assert.ok(preset.filter.length > 0, `${name}.filter must not be empty`);
      }
    });

    it('each preset filter is valid DSL', () => {
      for (const [name, preset] of Object.entries(FILTER_PRESETS)) {
        const result = validateFilterString(preset.filter);
        assert.equal(
          result.valid,
          true,
          `Preset "${name}" filter should be valid: ${preset.filter}`
        );
      }
    });
  });

  describe('resolvePreset', () => {
    it('resolves known presets', () => {
      assert.equal(resolvePreset('errors'), 'status-code:>=400');
      assert.equal(resolvePreset('api'), 'resource-type:XHR,Fetch');
      assert.equal(resolvePreset('large'), 'larger-than:1MB');
      assert.equal(resolvePreset('cached'), 'is:from-cache');
    });

    it('resolves presets case-insensitively', () => {
      assert.equal(resolvePreset('ERRORS'), 'status-code:>=400');
      assert.equal(resolvePreset('Errors'), 'status-code:>=400');
      assert.equal(resolvePreset('API'), 'resource-type:XHR,Fetch');
    });

    it('throws on unknown preset', () => {
      assert.throws(() => resolvePreset('unknown'), /Unknown preset: "unknown"/);
    });

    it('suggests available presets on error', () => {
      try {
        resolvePreset('invalid');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        const cmdError = error as Error & { metadata?: { suggestion?: string } };
        const suggestion = cmdError.metadata?.suggestion ?? '';
        assert.ok(
          suggestion.includes('errors') || suggestion.includes('Available presets'),
          `Expected suggestion to include preset names, got: "${suggestion}"`
        );
      }
    });
  });

  describe('getPresetNames', () => {
    it('returns array of preset names', () => {
      const names = getPresetNames();

      assert.ok(Array.isArray(names));
      assert.ok(names.length > 0);
      assert.ok(names.includes('errors'));
      assert.ok(names.includes('api'));
    });

    it('matches FILTER_PRESETS keys', () => {
      const names = getPresetNames();
      const keys = Object.keys(FILTER_PRESETS);

      assert.deepEqual(names.sort(), keys.sort());
    });
  });
});
