# OpenClaw DevEngine

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**State-machine-driven agentic workflow for automated software development.**

OpenClaw DevEngine orchestrates multiple AI agents to handle the complete software development lifecycle: Analysis, Planning, Implementation, Verification, and Documentation.

## ✨ Features

- 🏗️ **Architect Agent** — Breaks down goals into atomic file-level tasks
- 👷 **Builder Agent** — Generates complete, production-ready code
- 🔍 **Auditor Agent** — Creates comprehensive tests and verifies code
- 🔧 **Fixer Agent** — Self-heals code based on test failures
- 📝 **Scribe Agent** — Generates documentation
- ⚡ **Parallel Execution** — Tasks run concurrently when dependencies allow
- 💾 **Checkpointing** — Resume from failures without losing progress
- 🎯 **Error Classification** — Smart error categorization for targeted fixes
- 📊 **Event System** — Real-time progress tracking and monitoring

## 📦 Installation

```bash
npm install openclaw-dev-engine
```

Or install globally for CLI access:

```bash
npm install -g openclaw-dev-engine
```

## 🚀 Quick Start

### CLI Usage

```bash
# Set your API key
export OPENAI_API_KEY=your-api-key

# Create a new project
dev-engine "Create a REST API with Express and TypeScript"

# Extend existing project
dev-engine "Add user authentication" ./my-project

# Resume from checkpoint
dev-engine "Create a todo app" --resume

# Verbose mode with detailed logging
dev-engine "Build a CLI tool" --verbose

# Specify concurrency and model
dev-engine "Create a React app" --concurrency 5 --model gpt-4
```

### CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help message |
| `--version` | `-v` | Show version number |
| `--verbose` | `-V` | Enable verbose output |
| `--resume` | `-r` | Resume from last checkpoint |
| `--concurrency <n>` | `-c` | Max parallel tasks (default: 3) |
| `--model <name>` | `-m` | LLM model to use |

### Programmatic Usage

```typescript
import { DevEngine } from 'openclaw-dev-engine';
import { OpenClawAdapter } from 'openclaw-dev-engine/adapters';

const adapter = new OpenClawAdapter(process.env.OPENAI_API_KEY);
const engine = new DevEngine(adapter, {
  maxConcurrency: 3,
  verbose: true,
  enableCheckpoints: true
});

// Subscribe to events
engine.events.on('task:complete', async (e) => {
  console.log(`Completed: ${e.data.taskId}`);
});

// Track progress
engine.progress.onProgress((p) => {
  console.log(`${p.percentage}% complete`);
});

// Execute
const result = await engine.run('Create a REST API');
console.log(result);
```

### As an OpenClaw Skill

```typescript
import { DevEngine } from 'openclaw-dev-engine';
import { SkillContext } from 'openclaw-dev-engine/interfaces';

const engine = new DevEngine(openclawAdapter);

const result = await engine.execute({
  adapter: openclawAdapter,
  parameters: {
    goal: 'Create a React component library',
    resume: false
  },
  workingDirectory: process.cwd()
});

if (result.success) {
  console.log('Generated files:', result.artifacts);
} else {
  console.error('Failed:', result.error);
}
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DevEngine (ISkill)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Architect  │→ │   Builder    │→ │   Auditor   │→ │   Scribe    │  │
│  │  (Planning)  │  │   (Code)     │  │   (Test)    │  │   (Docs)    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘ └─────────────┘  │
│                            ↓                ↓                           │
│                    ┌──────────────────────────────┐                     │
│                    │           Fixer              │                     │
│                    │     (Self-Healing Loop)      │                     │
│                    └──────────────────────────────┘                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       TaskScheduler                              │   │
│  │  • DAG-based execution        • Concurrency control (Semaphore) │   │
│  │  • Dependency resolution      • Retry with backoff              │   │
│  │  • Priority scheduling        • Circular dependency detection    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌────────────────────┐  ┌─────────────────┐  ┌────────────────────┐   │
│  │   StateManager     │  │ InterfaceExtract│  │  ErrorClassifier   │   │
│  │  (Checkpointing)   │  │   (AST-based)   │  │  (10 Categories)   │   │
│  └────────────────────┘  └─────────────────┘  └────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     EngineEventEmitter                           │   │
│  │  • Typed events            • Progress tracking                   │   │
│  │  • Event history           • Filtered streams                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        IEnvironmentAdapter                              │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐   │
│  │ ILLMProvider│  │ IFileSystem │  │IShellAdapter│  │ IImageAdapter│   │
│  │ (streaming) │  │ (enhanced)  │  │(test runner)│  │  (optional)  │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## ⚙️ Configuration

### Engine Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrency` | number | 3 | Maximum parallel tasks |
| `maxRetries` | number | 3 | Retry attempts per task |
| `enableCheckpoints` | boolean | true | Enable state persistence |
| `checkpointDir` | string | `.openclaw/state` | Checkpoint directory |
| `verbose` | boolean | false | Enable verbose logging |
| `testTimeout` | number | 60000 | Test execution timeout (ms) |

### Adapter Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | string | `gpt-4-turbo-preview` | LLM model to use |
| `baseUrl` | string | OpenAI API | LLM API endpoint |
| `basePath` | string | `process.cwd()` | Working directory |
| `logPrefix` | string | `OpenClaw` | Log message prefix |

## 📡 Events

The engine emits typed events for monitoring:

```typescript
// Phase lifecycle
engine.events.on('phase:start', async (e) => {
  console.log(`Phase: ${e.data.phase}`);
});

// Task lifecycle
engine.events.on('task:start', async (e) => {
  console.log(`Starting: ${e.data.taskId}`);
});

engine.events.on('task:complete', async (e) => {
  console.log(`Done: ${e.data.taskId} in ${e.data.duration}ms`);
});

engine.events.on('task:failed', async (e) => {
  console.error(`Failed: ${e.data.taskId} - ${e.data.error}`);
});

// Checkpoints
engine.events.on('checkpoint:saved', async (e) => {
  console.log(`Saved: ${e.data.planId}`);
});

// LLM calls
engine.events.on('llm:request', async (e) => {
  console.log(`LLM call: ${e.data.tokens} tokens`);
});
```

## 🔌 Custom Adapters

Implement custom adapters for different environments:

```typescript
import { 
  IEnvironmentAdapter, 
  IFileSystem, 
  IShellAdapter, 
  ILLMProvider,
  ILogger 
} from 'openclaw-dev-engine/interfaces';

class MyCustomAdapter implements IEnvironmentAdapter {
  fs: IFileSystem = new MyFileSystem();
  shell: IShellAdapter = new MyShell();
  llm: ILLMProvider = new MyLLMProvider();
  logger: ILogger = new MyLogger();
  
  log(message: string, level = 'info') {
    this.logger.log(level, message);
  }
}

const engine = new DevEngine(new MyCustomAdapter());
```

## 🛡️ Error Handling

The engine automatically classifies errors and applies targeted fix strategies:

| Category | Examples | Fix Strategy |
|----------|----------|--------------|
| `syntax` | Missing brackets, invalid tokens | Check syntax structure |
| `type` | Type mismatches, missing types | Fix type annotations |
| `import` | Module not found, wrong path | Correct import paths |
| `runtime` | Null access, undefined vars | Add defensive checks |
| `assertion` | Test failures | Fix implementation or test |
| `timeout` | Hanging tests | Add async handling |
| `permission` | Access denied | Check file permissions |
| `resource` | File not found | Verify paths exist |
| `network` | Connection refused | Mock network calls |

## 🧪 Testing

```bash
# Run all tests
npm test

# Run unit tests only (mocked services)
npm run test:unit

# Run integration tests (mocked services)
npm run test:integration

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 📊 Benchmarks

Benchmarks test against real services and require API keys:

```bash
# Dry run (no API calls)
npm run benchmark:dry

# Run all benchmarks (costs $$$)
npm run benchmark

# Speed benchmarks only
npm run benchmark:speed

# Quality benchmarks only
npm run benchmark:quality
```

See [benchmarks/README.md](benchmarks/README.md) for details.

## 🔧 Development

```bash
# Clone repository
git clone https://github.com/openclaw/dev-engine

# Install dependencies
npm install

# Build
npm run build

# Type check
npm run typecheck

# Lint
npm run lint
```

## 📁 Project Structure

```
src/
├── index.ts                 # Main exports
├── cli.ts                   # CLI entry point
├── interfaces/              # TypeScript interfaces
├── core/                    # Core engine components
│   ├── DevEngine.ts         # Main orchestrator
│   ├── TaskScheduler.ts     # DAG execution
│   ├── StateManager.ts      # Checkpointing
│   ├── InterfaceExtractor.ts # AST extraction
│   ├── ErrorClassifier.ts   # Error categorization
│   └── EventEmitter.ts      # Event system
├── adapters/                # Environment adapters
└── skills/                  # Prompt templates

tests/
├── mocks/                   # Mock adapters
├── unit/                    # Unit tests
└── integration/             # Integration tests

benchmarks/
├── suites/                  # Benchmark implementations
└── results/                 # Benchmark outputs
```

## 🌍 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `OPENCLAW_KEY` | Yes* | Alternative key name |

*One of these is required.

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please read our [contributing guidelines](CONTRIBUTING.md) before submitting PRs.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request
