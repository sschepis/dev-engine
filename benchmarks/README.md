# OpenClaw DevEngine Benchmarks

This directory contains benchmarks that test the DevEngine against real services. Unlike unit tests, these benchmarks:

- Require actual API keys and network connectivity
- Make real LLM API calls (incurring costs)
- Create real files on disk
- Execute real shell commands

## Prerequisites

1. Set environment variables:
   ```bash
   export OPENAI_API_KEY=your-api-key
   # or
   export OPENCLAW_KEY=your-api-key
   ```

2. Install dependencies:
   ```bash
   npm install
   npm run build
   ```

## Running Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Run specific benchmark
npm run benchmark -- --testNamePattern="simple"

# Run with verbose output
npm run benchmark -- --verbose
```

## Benchmark Categories

### Speed Benchmarks
Measure execution time for various task complexities.

### Quality Benchmarks  
Evaluate the quality of generated code:
- Compilation success rate
- Test pass rate
- Code coverage metrics

### Cost Benchmarks
Track token usage and API costs:
- Tokens per task complexity
- Cost optimization opportunities

### Reliability Benchmarks
Test error recovery and edge cases:
- Self-healing success rate
- Checkpoint/resume reliability

## Output

Benchmark results are written to:
- `benchmarks/results/` - JSON results per run
- `benchmarks/reports/` - Human-readable reports

## Cost Estimation

| Benchmark | Est. Tokens | Est. Cost (GPT-4) |
|-----------|-------------|-------------------|
| Simple    | ~5,000      | ~$0.10            |
| Medium    | ~15,000     | ~$0.30            |
| Complex   | ~50,000     | ~$1.00            |
| Full      | ~100,000    | ~$2.00            |

## CI Integration

For CI/CD, use the `--dry-run` flag to validate benchmark structure without making API calls:

```bash
npm run benchmark -- --dry-run
```
