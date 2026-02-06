// =============================================================================
// OpenClaw DevEngine - Quality Benchmarks
// =============================================================================
//
// These benchmarks evaluate the quality of generated code:
// - Compilation success rate
// - Test pass rate
// - Type safety
// - Code structure
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

interface QualityMetrics {
  compiles: boolean;
  testsPass: boolean;
  testsPassed: number;
  testsFailed: number;
  lintErrors: number;
  typeErrors: number;
  codeLines: number;
  testCoverage?: number;
}

async function evaluateQuality(workDir: string): Promise<QualityMetrics> {
  const metrics: QualityMetrics = {
    compiles: false,
    testsPass: false,
    testsPassed: 0,
    testsFailed: 0,
    lintErrors: 0,
    typeErrors: 0,
    codeLines: 0
  };

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Check TypeScript compilation
  try {
    await execAsync('npx tsc --noEmit', { cwd: workDir });
    metrics.compiles = true;
  } catch (error: any) {
    const output = error.stdout || error.stderr || '';
    metrics.typeErrors = (output.match(/error TS\d+/g) || []).length;
  }

  // Run tests
  try {
    const { stdout } = await execAsync('npx jest --json --passWithNoTests', { cwd: workDir });
    const results = JSON.parse(stdout);
    metrics.testsPass = results.success;
    metrics.testsPassed = results.numPassedTests || 0;
    metrics.testsFailed = results.numFailedTests || 0;
  } catch (error: any) {
    try {
      const jsonMatch = error.stdout?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0]);
        metrics.testsPassed = results.numPassedTests || 0;
        metrics.testsFailed = results.numFailedTests || 0;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Count lines of code
  try {
    const files = await fs.readdir(workDir, { recursive: true });
    for (const file of files) {
      if (typeof file === 'string' && file.endsWith('.ts') && !file.includes('node_modules')) {
        const content = await fs.readFile(path.join(workDir, file), 'utf-8');
        metrics.codeLines += content.split('\n').filter(l => l.trim()).length;
      }
    }
  } catch {
    // Ignore errors
  }

  return metrics;
}

const QUALITY_TESTS = [
  {
    name: 'type-safety',
    goal: 'Create a TypeScript module with strict types: a generic Stack<T> class with push, pop, peek, and isEmpty methods',
    expectations: {
      compiles: true,
      minTestsPassed: 3
    }
  },
  {
    name: 'error-handling',
    goal: 'Create a file reader utility that handles FileNotFound, PermissionDenied, and InvalidEncoding errors with custom error classes',
    expectations: {
      compiles: true,
      minTestsPassed: 4
    }
  },
  {
    name: 'async-patterns',
    goal: 'Create an async task queue that processes tasks with configurable concurrency limit, timeout handling, and retry logic',
    expectations: {
      compiles: true,
      minTestsPassed: 5
    }
  }
];

async function runQualityBenchmark(
  test: typeof QUALITY_TESTS[0],
  config: ReturnType<typeof getConfig>
): Promise<BenchmarkResult> {
  const workDir = path.join(config.outputDir, `quality-${test.name}-${Date.now()}`);
  
  console.log(`\n🔍 Running quality benchmark: ${test.name}`);
  
  if (config.dryRun) {
    return {
      name: `quality-${test.name}`,
      category: 'quality',
      success: true,
      duration: 0,
      metrics: { dryRun: true },
      timestamp: new Date()
    };
  }

  await fs.mkdir(workDir, { recursive: true });
  
  // Create minimal package.json for TypeScript
  await fs.writeFile(path.join(workDir, 'package.json'), JSON.stringify({
    name: `quality-test-${test.name}`,
    type: 'module',
    devDependencies: {
      typescript: '^5.0.0',
      '@types/node': '^20.0.0',
      jest: '^29.0.0',
      '@types/jest': '^29.0.0',
      'ts-jest': '^29.0.0'
    }
  }, null, 2));

  await fs.writeFile(path.join(workDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist'
    },
    include: ['src/**/*']
  }, null, 2));

  const adapter = new OpenClawAdapter(config.apiKey, {
    model: config.model,
    basePath: workDir
  });
  
  const engine = new DevEngine(adapter, {
    maxConcurrency: 2,
    verbose: config.verbose,
    enableCheckpoints: false
  });

  const startTime = Date.now();
  let totalTokens = 0;
  
  engine.events.on('llm:response', async (e) => {
    totalTokens += (e.data.tokens as number) || 0;
  });

  try {
    await engine.run(test.goal);
    const duration = Date.now() - startTime;
    
    // Install dependencies and evaluate
    console.log('   Installing dependencies...');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    await promisify(exec)('npm install', { cwd: workDir });
    
    console.log('   Evaluating quality...');
    const metrics = await evaluateQuality(workDir);
    
    const success = 
      (test.expectations.compiles ? metrics.compiles : true) &&
      metrics.testsPassed >= (test.expectations.minTestsPassed || 0);
    
    console.log(`   ${success ? '✅' : '❌'} Compiles: ${metrics.compiles}, Tests: ${metrics.testsPassed}/${metrics.testsPassed + metrics.testsFailed}`);
    
    return {
      name: `quality-${test.name}`,
      category: 'quality',
      success,
      duration,
      metrics: {
        ...metrics,
        totalTokens,
        estimatedCost: estimateCost(totalTokens, config.model)
      },
      timestamp: new Date()
    };
    
  } catch (error) {
    return {
      name: `quality-${test.name}`,
      category: 'quality',
      success: false,
      duration: Date.now() - startTime,
      metrics: { totalTokens },
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    };
  }
}

export async function runQualityBenchmarks(): Promise<BenchmarkSuite> {
  const config = getConfig();
  const benchmarks: BenchmarkResult[] = [];
  
  console.log('\n🎯 Quality Benchmark Suite');
  console.log('==========================');
  
  for (const test of QUALITY_TESTS) {
    const result = await runQualityBenchmark(test, config);
    benchmarks.push(result);
    
    if (!config.dryRun) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  const totalDuration = benchmarks.reduce((sum, b) => sum + b.duration, 0);
  const totalTokens = benchmarks.reduce(
    (sum, b) => sum + ((b.metrics.totalTokens as number) || 0), 
    0
  );
  
  const suite: BenchmarkSuite = {
    name: 'Quality Benchmarks',
    description: 'Evaluates compilation, type safety, and test quality',
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
  
  console.log('\n📊 Quality Summary:');
  console.log(`   Total: ${suite.summary.total}, Passed: ${suite.summary.passed}, Failed: ${suite.summary.failed}`);
  console.log(`   Compilation Rate: ${(benchmarks.filter(b => b.metrics.compiles).length / benchmarks.length * 100).toFixed(0)}%`);
  
  return suite;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQualityBenchmarks().then(suite => {
    const config = getConfig();
    const resultsPath = path.join(config.resultsDir, `quality-${Date.now()}.json`);
    fs.mkdir(config.resultsDir, { recursive: true }).then(() => {
      fs.writeFile(resultsPath, JSON.stringify(suite, null, 2));
      console.log(`\nResults saved to: ${resultsPath}`);
    });
  }).catch(console.error);
}
