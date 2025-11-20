/**
 * Contract tests for machine-readable help generation.
 *
 * Tests the contract that dynamic capability counts match actual implementation:
 * - CDP domain count matches protocol
 * - CDP method count matches total across all domains
 * - High-level command count matches task mappings
 *
 * These tests prevent drift between hardcoded values and reality.
 */

import assert from 'node:assert';
import { describe, test, beforeEach } from 'node:test';

import { Command } from 'commander';

import { getAllDomainSummaries } from '@/cdp/schema.js';
import { generateMachineReadableHelp } from '@/commands/machineReadableHelp.js';
import { getAllTaskMappings } from '@/utils/taskMappings.js';

describe('Machine-readable help capabilities', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name('bdg').version('0.0.0-test');
    program.command('test').description('Test command');
  });

  describe('CDP capabilities', () => {
    test('cdp.domains matches actual CDP domain count', () => {
      const help = generateMachineReadableHelp(program);
      const actualDomains = getAllDomainSummaries();

      assert.strictEqual(help.capabilities.cdp.domains, actualDomains.length);
    });

    test('cdp.methods matches total CDP method count across all domains', () => {
      const help = generateMachineReadableHelp(program);
      const domainSummaries = getAllDomainSummaries();
      const totalMethods = domainSummaries.reduce((sum, domain) => sum + domain.commandCount, 0);

      assert.strictEqual(parseInt(help.capabilities.cdp.methods, 10), totalMethods);
    });

    test('cdp.methods is a valid numeric string', () => {
      const help = generateMachineReadableHelp(program);

      assert.strictEqual(typeof help.capabilities.cdp.methods, 'string');
      assert.ok(parseInt(help.capabilities.cdp.methods, 10) > 0);
      assert.strictEqual(isNaN(parseInt(help.capabilities.cdp.methods, 10)), false);
    });
  });

  describe('high-level command capabilities', () => {
    test('highLevel.commands matches task mapping count', () => {
      const help = generateMachineReadableHelp(program);
      const taskMappings = getAllTaskMappings();

      assert.strictEqual(help.capabilities.highLevel.commands, Object.keys(taskMappings).length);
    });

    test('highLevel.coverage includes expected domains', () => {
      const help = generateMachineReadableHelp(program);
      const expectedDomains = ['dom', 'network', 'console', 'session', 'monitoring'];

      for (const domain of expectedDomains) {
        assert.ok(
          help.capabilities.highLevel.coverage.includes(domain),
          `Expected coverage to include ${domain}`
        );
      }
    });
  });

  describe('capability counts are realistic', () => {
    test('CDP domain count is greater than 50', () => {
      const help = generateMachineReadableHelp(program);

      assert.ok(help.capabilities.cdp.domains > 50);
    });

    test('CDP method count is greater than 600', () => {
      const help = generateMachineReadableHelp(program);
      const methodCount = parseInt(help.capabilities.cdp.methods, 10);

      assert.ok(methodCount > 600);
    });

    test('high-level command count is greater than 10', () => {
      const help = generateMachineReadableHelp(program);

      assert.ok(help.capabilities.highLevel.commands > 10);
    });
  });

  describe('dynamic calculation prevents drift', () => {
    test('adding new task mapping increases command count', () => {
      const help = generateMachineReadableHelp(program);
      const taskMappings = getAllTaskMappings();

      assert.strictEqual(help.capabilities.highLevel.commands, Object.keys(taskMappings).length);
    });

    test('CDP counts change if protocol changes', () => {
      const help = generateMachineReadableHelp(program);
      const domainSummaries = getAllDomainSummaries();

      const calculatedTotal = domainSummaries.reduce((sum, domain) => sum + domain.commandCount, 0);
      const reportedTotal = parseInt(help.capabilities.cdp.methods, 10);

      assert.strictEqual(reportedTotal, calculatedTotal);
    });
  });

  describe('help structure includes capabilities', () => {
    test('capabilities object exists in help output', () => {
      const help = generateMachineReadableHelp(program);

      assert.ok(help.capabilities);
      assert.ok(help.capabilities.cdp);
      assert.ok(help.capabilities.highLevel);
    });

    test('capabilities structure matches expected shape', () => {
      const help = generateMachineReadableHelp(program);

      assert.strictEqual(typeof help.capabilities.cdp.domains, 'number');
      assert.strictEqual(typeof help.capabilities.cdp.methods, 'string');
      assert.strictEqual(typeof help.capabilities.highLevel.commands, 'number');
      assert.ok(Array.isArray(help.capabilities.highLevel.coverage));
    });
  });
});
