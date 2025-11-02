/**
 * Benchmark script for measuring bdg performance across different scenarios.
 *
 * Runs bdg with various collector combinations and measures:
 * - JSON serialization time
 * - File write time and sizes
 * - Collector initialization time
 * - Total session duration
 * - Memory usage
 *
 * Usage:
 *   npm run benchmark
 *   tsx scripts/benchmark.ts
 *   tsx scripts/benchmark.ts --output docs/perf/collector-baseline.md
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBenchmarkServer, type BenchmarkServer } from './benchmark-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const bdgBinary = resolve(projectRoot, 'dist/index.js');
const sessionDir = resolve(process.env.HOME!, '.bdg');

interface BenchmarkScenario {
  name: string;
  args: string[];
  description: string;
}

interface BenchmarkMetrics {
  scenario: string;
  duration: number;
  collectors: string[];
  fileSize: { preview: number; full: number; final: number };
  jsonStringifyTime: { preview: number; full: number };
  fileWriteTime: { preview: number; full: number };
  collectorInitTime: number;
  memoryUsage: { heapUsed: number; rss: number };
  bodiesFetched?: number;
  bodiesSkipped?: number;
}

const scenarios: BenchmarkScenario[] = [
  {
    name: 'all-collectors',
    args: [],
    description: 'All collectors (DOM + Network + Console)',
  },
  {
    name: 'network-only',
    args: ['--network'],
    description: 'Network collector only',
  },
  {
    name: 'dom-only',
    args: ['--dom'],
    description: 'DOM collector only',
  },
  {
    name: 'console-only',
    args: ['--console'],
    description: 'Console collector only',
  },
  {
    name: 'network-console',
    args: ['--network', '--console'],
    description: 'Network + Console (skip DOM)',
  },
];

/**
 * Parse PERF logs from stderr output.
 */
function parsePerfLogs(stderr: string): Partial<BenchmarkMetrics> {
  const metrics: Partial<BenchmarkMetrics> = {};

  // Extract JSON stringify times
  const previewStringifyMatch = stderr.match(/Preview JSON\.stringify: ([\d.]+)ms/);
  const fullStringifyMatch = stderr.match(/Full JSON\.stringify: ([\d.]+)ms/);
  if (previewStringifyMatch || fullStringifyMatch) {
    metrics.jsonStringifyTime = {
      preview: previewStringifyMatch ? parseFloat(previewStringifyMatch[1]) : 0,
      full: fullStringifyMatch ? parseFloat(fullStringifyMatch[1]) : 0,
    };
  }

  // Extract file write times
  const previewWriteMatch = stderr.match(/Preview total write: ([\d.]+)ms/);
  const fullWriteMatch = stderr.match(/Full total write: ([\d.]+)ms/);
  if (previewWriteMatch || fullWriteMatch) {
    metrics.fileWriteTime = {
      preview: previewWriteMatch ? parseFloat(previewWriteMatch[1]) : 0,
      full: fullWriteMatch ? parseFloat(fullWriteMatch[1]) : 0,
    };
  }

  // Extract collector init time
  const collectorInitMatch = stderr.match(/All collectors initialized in ([\d.]+)ms/);
  if (collectorInitMatch) {
    metrics.collectorInitTime = parseFloat(collectorInitMatch[1]);
  }

  // Extract memory usage
  const memoryMatch = stderr.match(/Memory: heap=([\d.]+)MB, RSS=([\d.]+)MB/);
  if (memoryMatch) {
    metrics.memoryUsage = {
      heapUsed: parseFloat(memoryMatch[1]),
      rss: parseFloat(memoryMatch[2]),
    };
  }

  // Extract active collectors
  const collectorsMatch = stderr.match(/active collectors: \[(.*?)\]/);
  if (collectorsMatch) {
    metrics.collectors = collectorsMatch[1].split(', ').map((c) => c.replace(/'/g, ''));
  }

  return metrics;
}

/**
 * Get file sizes for session files.
 */
async function getFileSizes(): Promise<{ preview: number; full: number; final: number }> {
  const sizes = { preview: 0, full: 0, final: 0 };

  try {
    const previewPath = resolve(sessionDir, 'session.preview.json');
    const previewStat = await stat(previewPath);
    sizes.preview = previewStat.size;
  } catch {
    // File may not exist
  }

  try {
    const fullPath = resolve(sessionDir, 'session.full.json');
    const fullStat = await stat(fullPath);
    sizes.full = fullStat.size;
  } catch {
    // File may not exist
  }

  try {
    const finalPath = resolve(sessionDir, 'session.json');
    const finalStat = await stat(finalPath);
    sizes.final = finalStat.size;
  } catch {
    // File may not exist
  }

  return sizes;
}

/**
 * Run bdg with given arguments and collect metrics.
 */
async function runBdgScenario(
  url: string,
  args: string[],
  durationMs: number = 3000
): Promise<BenchmarkMetrics> {
  const startTime = Date.now();
  let stderrOutput = '';

  // Start bdg process
  const bdgProcess = spawn('node', [bdgBinary, url, '--timeout', '3', ...args], {
    cwd: projectRoot,
    env: { ...process.env },
  });

  // Capture stderr (where PERF logs go)
  bdgProcess.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  // Wait for process to complete
  await new Promise<void>((resolve, reject) => {
    bdgProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`bdg exited with code ${code}`));
      }
    });
    bdgProcess.on('error', reject);
  });

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Parse PERF logs
  const perfMetrics = parsePerfLogs(stderrOutput);

  // Get file sizes
  const fileSizes = await getFileSizes();

  return {
    scenario: args.join(' ') || 'default',
    duration,
    collectors: perfMetrics.collectors ?? [],
    fileSize: fileSizes,
    jsonStringifyTime: perfMetrics.jsonStringifyTime ?? { preview: 0, full: 0 },
    fileWriteTime: perfMetrics.fileWriteTime ?? { preview: 0, full: 0 },
    collectorInitTime: perfMetrics.collectorInitTime ?? 0,
    memoryUsage: perfMetrics.memoryUsage ?? { heapUsed: 0, rss: 0 },
  };
}

/**
 * Format file size in human-readable format.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Generate markdown report from benchmark results.
 */
function generateMarkdownReport(results: BenchmarkMetrics[]): string {
  const timestamp = new Date().toISOString();

  let report = `# bdg Performance Benchmark Baseline\n\n`;
  report += `**Generated:** ${timestamp}\n\n`;
  report += `**Node Version:** ${process.version}\n\n`;
  report += `## Scenarios\n\n`;

  scenarios.forEach((scenario, i) => {
    const result = results[i];
    report += `### ${scenario.name}\n\n`;
    report += `**Description:** ${scenario.description}\n\n`;
    report += `**Active Collectors:** ${result.collectors.join(', ')}\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Duration | ${result.duration}ms |\n`;
    report += `| Collector Init | ${result.collectorInitTime.toFixed(2)}ms |\n`;
    report += `| Preview JSON Stringify | ${result.jsonStringifyTime.preview.toFixed(2)}ms |\n`;
    report += `| Full JSON Stringify | ${result.jsonStringifyTime.full.toFixed(2)}ms |\n`;
    report += `| Preview Write Time | ${result.fileWriteTime.preview.toFixed(2)}ms |\n`;
    report += `| Full Write Time | ${result.fileWriteTime.full.toFixed(2)}ms |\n`;
    report += `| Preview File Size | ${formatBytes(result.fileSize.preview)} |\n`;
    report += `| Full File Size | ${formatBytes(result.fileSize.full)} |\n`;
    report += `| Final File Size | ${formatBytes(result.fileSize.final)} |\n`;
    report += `| Heap Used | ${result.memoryUsage.heapUsed.toFixed(2)} MB |\n`;
    report += `| RSS | ${result.memoryUsage.rss.toFixed(2)} MB |\n\n`;
  });

  report += `## Comparison\n\n`;
  report += `| Scenario | Duration | Preview Size | Full Size | Final Size | Collectors |\n`;
  report += `|----------|----------|--------------|-----------|------------|------------|\n`;

  results.forEach((result, i) => {
    report += `| ${scenarios[i].name} | ${result.duration}ms | ${formatBytes(result.fileSize.preview)} | ${formatBytes(result.fileSize.full)} | ${formatBytes(result.fileSize.final)} | ${result.collectors.join(', ')} |\n`;
  });

  report += `\n## Notes\n\n`;
  report += `- All scenarios run for 3 seconds against the benchmark test server\n`;
  report += `- Preview and Full files written every 5 seconds during collection\n`;
  report += `- Final file written on session stop\n`;
  report += `- File sizes and timing may vary based on network activity and page complexity\n`;

  return report;
}

/**
 * Main benchmark runner.
 */
async function main() {
  console.log('Starting bdg performance benchmark...\n');

  // Parse CLI args
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath =
    outputIndex !== -1 && args[outputIndex + 1]
      ? resolve(projectRoot, args[outputIndex + 1])
      : resolve(projectRoot, 'docs/perf/collector-baseline.md');

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // Start benchmark server
  console.log('Starting benchmark server...');
  let server: BenchmarkServer | null = null;
  try {
    server = await startBenchmarkServer();
    console.log(`Server started at ${server.url}\n`);

    // Build bdg first
    console.log('Building bdg...');
    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    await new Promise<void>((resolve, reject) => {
      buildProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build failed with code ${code}`));
        }
      });
    });
    console.log('Build complete\n');

    // Run each scenario
    const results: BenchmarkMetrics[] = [];
    for (const scenario of scenarios) {
      console.log(`Running scenario: ${scenario.name}`);
      console.log(`  Args: ${scenario.args.join(' ') || '(none)'}`);
      console.log(`  Description: ${scenario.description}`);

      const metrics = await runBdgScenario(server.url, scenario.args);
      results.push(metrics);

      console.log(`  ✓ Duration: ${metrics.duration}ms`);
      console.log(`  ✓ Collectors: ${metrics.collectors.join(', ')}`);
      console.log(`  ✓ Final size: ${formatBytes(metrics.fileSize.final)}\n`);
    }

    // Generate report
    console.log('Generating report...');
    const report = generateMarkdownReport(results);
    await writeFile(outputPath, report, 'utf-8');
    console.log(`\n✓ Benchmark complete!`);
    console.log(`  Report saved to: ${outputPath}`);
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(1);
  } finally {
    // Clean up server
    if (server) {
      await server.close();
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { runBdgScenario, generateMarkdownReport };
