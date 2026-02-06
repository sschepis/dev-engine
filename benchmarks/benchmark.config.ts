// =============================================================================
// OpenClaw DevEngine - Benchmark Configuration
// =============================================================================

export interface BenchmarkConfig {
  apiKey: string;
  model: string;
  outputDir: string;
  resultsDir: string;
  timeout: number;
  verbose: boolean;
  dryRun: boolean;
}

export interface BenchmarkResult {
  name: string;
  category: 'speed' | 'quality' | 'cost' | 'reliability';
  success: boolean;
  duration: number;
  metrics: Record<string, number | string | boolean>;
  error?: string;
  timestamp: Date;
}

export interface BenchmarkSuite {
  name: string;
  description: string;
  benchmarks: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
    totalTokens: number;
    estimatedCost: number;
  };
}

export function getConfig(): BenchmarkConfig {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENCLAW_KEY;
  
  if (!apiKey && !process.argv.includes('--dry-run')) {
    throw new Error('OPENAI_API_KEY or OPENCLAW_KEY is required for benchmarks');
  }

  return {
    apiKey: apiKey || 'dry-run-key',
    model: process.env.BENCHMARK_MODEL || 'gpt-4-turbo-preview',
    outputDir: 'benchmarks/output',
    resultsDir: 'benchmarks/results',
    timeout: parseInt(process.env.BENCHMARK_TIMEOUT || '300000', 10),
    verbose: process.argv.includes('--verbose'),
    dryRun: process.argv.includes('--dry-run')
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

export function estimateCost(tokens: number, model: string): number {
  // Rough cost estimates per 1K tokens
  const costs: Record<string, number> = {
    'gpt-4-turbo-preview': 0.01,
    'gpt-4': 0.03,
    'gpt-3.5-turbo': 0.002,
    'claude-3-opus': 0.015,
    'claude-3-sonnet': 0.003
  };
  
  const costPer1K = costs[model] || 0.01;
  return (tokens / 1000) * costPer1K;
}
