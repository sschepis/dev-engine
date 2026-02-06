# OpenClaw DevEngine

<!-- SKILL-META
id: openclaw.dev-engine
version: 2.0.0
author: OpenClaw
description: State-machine-driven agentic workflow for automated software development
capabilities:
  - code-generation
  - test-generation
  - documentation
  - self-healing
  - parallel-execution
  - checkpoint-resume
  - error-classification
requires:
  llm: true
  filesystem: true
  shell: true
  images: false
invocation:
  cli: dev-engine <goal> [repo-path] [options]
  api: DevEngine.execute(context)
parameters:
  - name: goal
    type: string
    required: true
    description: Natural language description of what to build
  - name: repoPath
    type: string
    required: false
    description: Path to existing codebase for context
  - name: resume
    type: boolean
    required: false
    default: false
    description: Resume from last checkpoint if available
-->

The OpenClaw DevEngine is a **state-machine-driven agentic workflow** for automated software development. It orchestrates multiple AI agents to handle Analysis, Planning, Implementation, Verification, and Documentation.

## Features

| Feature | Description |
|---------|-------------|
| 🏗️ **Architect Agent** | Breaks down goals into atomic file-level tasks with dependency resolution |
| 👷 **Builder Agent** | Generates complete, production-ready TypeScript/JavaScript code |
| 🔍 **Auditor Agent** | Creates comprehensive tests (Jest/Vitest/Mocha) and verifies code |
| 🔧 **Fixer Agent** | Self-heals code based on test failures with 10 error categories |
| 📝 **Scribe Agent** | Generates README and documentation |
| ⚡ **Parallel Execution** | DAG-based scheduling with configurable concurrency limits |
| 💾 **Checkpointing** | Resume from failures without losing progress |
| 📊 **Event System** | Real-time progress tracking with typed events |

## Installation

```bash
npm install openclaw-dev-engine
```

## Quick Start

### CLI Usage

```bash
# Set your API key
export OPENAI_API_KEY=your-api-key

# Create a new project
dev-engine "Create a REST API with Express and TypeScript"

# Extend existing project
dev-engine "Add user authentication" ./my-project

# Resume from checkpoint with verbose output
dev-engine "Create a todo app" --resume --verbose
```

### CLI Options

```
dev-engine <goal> [repo-path] [options]

Options:
  -h, --help          Show help message
  -v, --version       Show version number
  -V, --verbose       Enable verbose output
  -r, --resume        Resume from last checkpoint
  -c, --concurrency   Max parallel tasks (default: 3)
  -m, --model         LLM model to use
```

### Programmatic Usage

```typescript
import { DevEngine } from 'openclaw-dev-engine';
import { OpenClawAdapter } from 'openclaw-dev-engine/adapters';

const adapter = new OpenClawAdapter(process.env.OPENAI_API_KEY, {
  model: 'gpt-4-turbo-preview'
});

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
  console.log(`${p.percentage}% complete (${p.completedTasks}/${p.totalTasks})`);
});

// Execute
const result = await engine.run('Create a greeting module');
console.log(result);
```

### As an OpenClaw Skill

```typescript
import { DevEngine } from 'openclaw-dev-engine';

const engine = new DevEngine(openclawAdapter);

// Use ISkill interface
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
  console.log('Plan ID:', result.metadata?.planId);
} else {
  console.error('Failed:', result.error);
}

// Validate parameters before execution
const errors = await engine.validate(context);
if (errors.length > 0) {
  console.error('Validation errors:', errors);
}

// Estimate cost before execution
const estimate = await engine.estimateCost(context);
console.log(`Estimated: ${estimate.tokens} tokens (~$${estimate.cost.toFixed(2)})`);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DevEngine (ISkill)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  Phases: Context → Architect → Builder → Auditor/Fixer → Scribe        │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │  TaskScheduler  │  │  StateManager   │  │  EngineEventEmitter     │ │
│  │  (DAG + Sem.)   │  │  (Checkpoint)   │  │  (Progress)             │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐                              │
│  │InterfaceExtract │  │ ErrorClassifier │                              │
│  │  (AST-based)    │  │ (10 Categories) │                              │
│  └─────────────────┘  └─────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        IEnvironmentAdapter                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐   │
│  │ ILLMProvider│  │ IFileSystem │  │IShellAdapter│  │ IImageAdapter│   │
│  │ (streaming) │  │ (enhanced)  │  │(test runner)│  │  (optional)  │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Configuration

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

## Events

```typescript
// All available event types
type EngineEventType = 
  | 'engine:start'      | 'engine:complete'    | 'engine:error'
  | 'phase:start'       | 'phase:complete'
  | 'task:start'        | 'task:progress'      | 'task:complete'
  | 'task:failed'       | 'task:retry'
  | 'llm:request'       | 'llm:response'       | 'llm:stream'
  | 'checkpoint:saved'  | 'checkpoint:restored';

// Subscribe to events
engine.events.on('phase:start', async (e) => {
  console.log(`Phase: ${e.data.phase}`);
});

// Wait for specific event
const event = await engine.events.waitFor('task:complete', 30000);

// Filter events
const taskEvents = engine.events.filter(e => e.type.startsWith('task:'));
```

## Error Classification

The Fixer agent uses smart error classification for targeted repairs:

| Category | Pattern Examples | Fix Strategy |
|----------|------------------|--------------|
| `syntax` | `SyntaxError`, `Unexpected token` | Check brackets, semicolons |
| `type` | `TypeError`, `TS2xxx` | Fix type annotations |
| `import` | `Cannot find module` | Correct import paths |
| `runtime` | `ReferenceError`, `null is not` | Add defensive checks |
| `assertion` | `expect().toBe()` failures | Fix code or test |
| `timeout` | `Async callback not invoked` | Handle async properly |
| `permission` | `EACCES`, `EPERM` | Check file permissions |
| `resource` | `ENOENT`, `File not found` | Verify paths exist |
| `network` | `ECONNREFUSED` | Mock network calls |

## Custom Adapters

```typescript
import { 
  IEnvironmentAdapter, 
  IFileSystem, 
  IShellAdapter, 
  ILLMProvider 
} from 'openclaw-dev-engine/interfaces';

class MyAdapter implements IEnvironmentAdapter {
  fs: IFileSystem = new MyFS();
  shell: IShellAdapter = new MyShell();
  llm: ILLMProvider = new MyLLM();
  logger = new MyLogger();
  
  log(message: string, level = 'info') {
    this.logger.log(level, message);
  }
}
```

## Testing

The project includes comprehensive test coverage:

```bash
# Unit tests (mocked services - no API calls)
npm run test:unit

# Integration tests (mocked services)
npm run test:integration

# All tests with coverage
npm run test:coverage

# Benchmarks (real services - costs money)
npm run benchmark:dry    # Dry run first
npm run benchmark        # Full run
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes* | OpenAI API key |
| `OPENCLAW_KEY` | Yes* | Alternative key name |

*One of these is required.

## License

MIT

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
