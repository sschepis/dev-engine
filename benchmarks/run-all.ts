#!/usr/bin/env npx ts-node
// =============================================================================
// OpenClaw DevEngine - Run All Benchmarks
// =============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig, BenchmarkSuite, formatDuration, estimateCost } from './benchmark.config.js';
import { runSpeedBenchmarks } from './suites/speed.benchmark.js';
import { runQualityBenchmarks } from './suites/quality.benchmark.js';

interface FullReport {
  timestamp: Date;
  config: {
    model: string;
    dryRun: boolean;
  };
  suites: BenchmarkSuite[];
  totals: {
    benchmarks: number;
    passed: number;
    failed: number;
    duration: number;
    totalTokens: number;
    estimatedCost: number;
  };
}

async function runAllBenchmarks(): Promise<FullReport> {
  const config = getConfig();
  
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           OpenClaw DevEngine Benchmark Suite                  ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Model: ${config.model.padEnd(52)}║`);
  console.log(`║  Dry Run: ${config.dryRun ? 'Yes'.padEnd(50) : 'No'.padEnd(51)}║`);
  console.log(`║  Verbose: ${config.verbose ? 'Yes'.padEnd(50) : 'No'.padEnd(51)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();
  const suites: BenchmarkSuite[] = [];

  // Run speed benchmarks
  try {
    const speedSuite = await runSpeedBenchmarks();
    suites.push(speedSuite);
  } catch (error) {
    console.error('Speed benchmarks failed:', error);
  }

  // Run quality benchmarks
  try {
    const qualitySuite = await runQualityBenchmarks();
    suites.push(qualitySuite);
  } catch (error) {
    console.error('Quality benchmarks failed:', error);
  }

  // Calculate totals
  const totals = suites.reduce(
    (acc, suite) => ({
      benchmarks: acc.benchmarks + suite.summary.total,
      passed: acc.passed + suite.summary.passed,
      failed: acc.failed + suite.summary.failed,
      duration: acc.duration + suite.summary.duration,
      totalTokens: acc.totalTokens + suite.summary.totalTokens,
      estimatedCost: acc.estimatedCost + suite.summary.estimatedCost
    }),
    { benchmarks: 0, passed: 0, failed: 0, duration: 0, totalTokens: 0, estimatedCost: 0 }
  );

  const report: FullReport = {
    timestamp: new Date(),
    config: {
      model: config.model,
      dryRun: config.dryRun
    },
    suites,
    totals
  };

  // Print summary
  const totalDuration = Date.now() - startTime;
  
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    BENCHMARK RESULTS                          ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Benchmarks: ${String(totals.benchmarks).padEnd(42)}║`);
  console.log(`║  Passed: ${String(totals.passed).padEnd(52)}║`);
  console.log(`║  Failed: ${String(totals.failed).padEnd(52)}║`);
  console.log(`║  Pass Rate: ${(totals.passed / totals.benchmarks * 100).toFixed(1)}%`.padEnd(62) + '║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Duration: ${formatDuration(totalDuration).padEnd(44)}║`);
  console.log(`║  Total Tokens: ${String(totals.totalTokens).padEnd(46)}║`);
  console.log(`║  Estimated Cost: $${totals.estimatedCost.toFixed(2).padEnd(43)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // Save report
  await fs.mkdir(config.resultsDir, { recursive: true });
  const reportPath = path.join(config.resultsDir, `full-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Full report saved to: ${reportPath}`);

  // Generate markdown report
  const markdownReport = generateMarkdownReport(report, totalDuration);
  const markdownPath = path.join(config.resultsDir, `report-${Date.now()}.md`);
  await fs.writeFile(markdownPath, markdownReport);
  console.log(`📝 Markdown report saved to: ${markdownPath}`);

  return report;
}

function generateMarkdownReport(report: FullReport, totalDuration: number): string {
  const lines: string[] = [
    '# OpenClaw DevEngine Benchmark Report',
    '',
    `**Date:** ${report.timestamp.toISOString()}`,
    `**Model:** ${report.config.model}`,
    `**Dry Run:** ${report.config.dryRun ? 'Yes' : 'No'}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total Benchmarks | ${report.totals.benchmarks} |`,
    `| Passed | ${report.totals.passed} |`,
    `| Failed | ${report.totals.failed} |`,
    `| Pass Rate | ${(report.totals.passed / report.totals.benchmarks * 100).toFixed(1)}% |`,
    `| Duration | ${formatDuration(totalDuration)} |`,
    `| Tokens Used | ${report.totals.totalTokens.toLocaleString()} |`,
    `| Estimated Cost | $${report.totals.estimatedCost.toFixed(2)} |`,
    ''
  ];

  for (const suite of report.suites) {
    lines.push(`## ${suite.name}`);
    lines.push('');
    lines.push(suite.description);
    lines.push('');
    lines.push('| Benchmark | Status | Duration | Tokens |');
    lines.push('|-----------|--------|----------|--------|');
    
    for (const benchmark of suite.benchmarks) {
      const status = benchmark.success ? '✅ Pass' : '❌ Fail';
      const duration = formatDuration(benchmark.duration);
      const tokens = benchmark.metrics.totalTokens || 'N/A';
      lines.push(`| ${benchmark.name} | ${status} | ${duration} | ${tokens} |`);
    }
    
    lines.push('');
  }

  return lines.join('\n');
}

// Main execution
runAllBenchmarks()
  .then((report) => {
    process.exit(report.totals.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('Benchmark suite failed:', error);
    process.exit(1);
  });
