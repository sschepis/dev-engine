// =============================================================================
// OpenClaw DevEngine - Speed Benchmarks
// =============================================================================
// 
// These benchmarks measure execution time for various task complexities.
// They require real API access and will incur costs.
//

import * as fs from 'fs/promises';
import * as path from 'path';
import { DevEngine } from '../../src/core/DevEngine.js';
import { OpenClawAdapter } from '../../src/adapters/OpenClawAdapter.js';
import { 
  getConfig, 
  BenchmarkResult, 
  BenchmarkSuite, 
  formatDuration,
  estimateCost 
} from '../benchmark.config.js';

const BENCHMARK_GOALS = {
  simple: 'Create a TypeScript function that calculates the factorial of a number',
  
  medium: `Create a TypeScript module with the following features:
    1. A User class with id, name, and email properties
    2. A UserValidator that validates email format
    3. A UserRepository interface with CRUD methods
    4. Unit tests for the validator`,
  
  complex: `Create a complete REST API module with:
    1. Express router with GET, POST, PUT, DELETE endpoints
    2. Request validation using Zod schemas
    3. Error handling middleware
    4. Response formatting utilities
    5. Rate limiting middleware
    6. Comprehensive unit tests for all components`,
  
  realWorld: `Build a complete authentication system including:
    1. User model with hashed passwords
    2. JWT token generation and validation
    3. Login and registration endpoints
    4. Password reset functionality with email tokens
    5. Session management
    6. Rate limiting for auth endpoints
    7. Comprehensive test coverage
    8. Documentation in README`
};

async function runSpeedBenchmark(
  name: keyof typeof BENCHMARK_GOALS,
  config: ReturnType<typeof getConfig>
): Promise<BenchmarkResult> {
  const goal = BENCHMARK_GOALS[name];
  const workDir = path.join(config.outputDir, `speed-${name}-${Date.now()}`);
  
  console.log(`\n📊 Running speed benchmark: ${name}`);
  console.log(`   Goal: ${goal.slice(0, 60)}...`);
  
  if (config.dryRun) {
    return {
      name: `speed-${name}`,
      category: 'speed',
      success: true,
      duration: 0,
      metrics: { dryRun: true },
      timestamp: new Date()
    };
  }

  await fs.mkdir(workDir, { recursive: true });
  
  const adapter = new OpenClawAdapter(config.apiKey, {
    model: config.model,
    basePath: workDir
  });
  
  const engine = new DevEngine(adapter, {
    maxConcurrency: 3,
    verbose: config.verbose,
    enableCheckpoints: true,
    checkpointDir: path.join(workDir, '.state')
  });

  let totalTokens = 0;
  let llmCalls = 0;
  
  // Track LLM usage
  engine.events.on('llm:response', async (e) => {
    totalTokens += (e.data.tokens as number) || 0;
    llmCalls++;
  });

  const startTime = Date.now();
  
  try {
    await engine.run(goal);
    
    const duration = Date.now() - startTime;
    
    // Count generated files
    const files = await fs.readdir(workDir, { recursive: true });
    const sourceFiles = files.filter(f => 
      typeof f === 'string' && 
      (f.endsWith('.ts') || f.endsWith('.js'))
    );
    
    console.log(`   ✅ Completed in ${formatDuration(duration)}`);
    console.log(`   📁 Generated ${sourceFiles.length} files`);
    console.log(`   🔢 ${totalTokens} tokens, ${llmCalls} LLM calls`);
    
    return {
      name: `speed-${name}`,
      category: 'speed',
      success: true,
      duration,
      metrics: {
        filesGenerated: sourceFiles.length,
        totalTokens,
        llmCalls,
        estimatedCost: estimateCost(totalTokens, config.model),
        tokensPerSecond: Math.round(totalTokens / (duration / 1000))
      },
      timestamp: new Date()
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`   ❌ Failed after ${formatDuration(duration)}`);
    
    return {
      name: `speed-${name}`,
      category: 'speed',
      success: false,
      duration,
      metrics: { totalTokens, llmCalls },
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    };
  }
}

export async function runSpeedBenchmarks(): Promise<BenchmarkSuite> {
  const config = getConfig();
  const benchmarks: BenchmarkResult[] = [];
  
  console.log('\n🏃 Speed Benchmark Suite');
  console.log('========================');
  
  // Run benchmarks in order of complexity
  for (const level of ['simple', 'medium', 'complex'] as const) {
    const result = await runSpeedBenchmark(level, config);
    benchmarks.push(result);
    
    // Brief pause between benchmarks
    if (!config.dryRun) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Calculate summary
  const totalDuration = benchmarks.reduce((sum, b) => sum + b.duration, 0);
  const totalTokens = benchmarks.reduce(
    (sum, b) => sum + ((b.metrics.totalTokens as number) || 0), 
    0
  );
  
  const suite: BenchmarkSuite = {
    name: 'Speed Benchmarks',
    description: 'Measures execution time for various task complexities',
    benchmarks,
    summary: {
      total: benchmarks.length,
      passed: benchmarks.filter(b => b.success).length,
      failed: benchmarks.filter(b => !b.success).length,
      duration: totalDuration,
      totalTokens,
      estimatedCost: estimateCost(totalTokens, config.model)
    }
  };
  
  console.log('\n📈 Speed Summary:');
  console.log(`   Total: ${suite.summary.total}, Passed: ${suite.summary.passed}, Failed: ${suite.summary.failed}`);
  console.log(`   Duration: ${formatDuration(suite.summary.duration)}`);
  console.log(`   Tokens: ${suite.summary.totalTokens}`);
  console.log(`   Est. Cost: $${suite.summary.estimatedCost.toFixed(2)}`);
  
  return suite;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSpeedBenchmarks().then(suite => {
    const config = getConfig();
    const resultsPath = path.join(config.resultsDir, `speed-${Date.now()}.json`);
    fs.mkdir(config.resultsDir, { recursive: true }).then(() => {
      fs.writeFile(resultsPath, JSON.stringify(suite, null, 2));
      console.log(`\nResults saved to: ${resultsPath}`);
    });
  }).catch(console.error);
}
