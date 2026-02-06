#!/usr/bin/env node
// =============================================================================
// OpenClaw DevEngine - CLI Entry Point
// =============================================================================
import { DevEngine } from './core/DevEngine.js';
import { OpenClawAdapter } from './adapters/OpenClawAdapter.js';
import * as dotenv from 'dotenv';
dotenv.config();
function parseArgs(argv) {
    const args = { goal: '' };
    const positional = [];
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
        }
        else if (arg === '--version' || arg === '-v') {
            args.version = true;
        }
        else if (arg === '--resume' || arg === '-r') {
            args.resume = true;
        }
        else if (arg === '--verbose' || arg === '-V') {
            args.verbose = true;
        }
        else if (arg === '--concurrency' || arg === '-c') {
            args.maxConcurrency = parseInt(argv[++i], 10);
        }
        else if (arg === '--model' || arg === '-m') {
            args.model = argv[++i];
        }
        else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }
    args.goal = positional[0] || '';
    args.repoPath = positional[1];
    return args;
}
function printHelp() {
    console.log(`
OpenClaw DevEngine - AI-Powered Development Workflow

USAGE:
  dev-engine <goal> [repo-path] [options]

ARGUMENTS:
  goal        Natural language description of what to build
  repo-path   (Optional) Path to existing codebase for context

OPTIONS:
  -h, --help          Show this help message
  -v, --version       Show version number
  -V, --verbose       Enable verbose output with detailed logging
  -r, --resume        Resume from last checkpoint if available
  -c, --concurrency   Maximum parallel tasks (default: 3)
  -m, --model         LLM model to use (default: gpt-4-turbo-preview)

ENVIRONMENT VARIABLES:
  OPENAI_API_KEY      OpenAI API key (required)
  OPENCLAW_KEY        Alternative API key name

EXAMPLES:
  # Create a new project
  dev-engine "Create a REST API with Express and TypeScript"
  
  # Extend an existing project
  dev-engine "Add authentication with JWT" ./my-project
  
  # Resume a failed run
  dev-engine "Create a React app" --resume --verbose

For more information, visit: https://github.com/openclaw/dev-engine
`);
}
function printVersion() {
    // Read from package.json would be ideal, but we'll hardcode for simplicity
    console.log('dev-engine version 2.0.0');
}
// =============================================================================
// Main Execution
// =============================================================================
async function main() {
    const args = parseArgs(process.argv);
    // Handle help/version flags
    if (args.help) {
        printHelp();
        process.exit(0);
    }
    if (args.version) {
        printVersion();
        process.exit(0);
    }
    // Validate required arguments
    if (!args.goal) {
        console.error('Error: Goal is required.\n');
        printHelp();
        process.exit(1);
    }
    // Get API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENCLAW_KEY;
    if (!apiKey) {
        console.error('Error: OPENAI_API_KEY or OPENCLAW_KEY environment variable is required.');
        process.exit(1);
    }
    // Configure adapter
    const adapterOptions = {
        model: args.model,
        logPrefix: 'DevEngine'
    };
    const adapter = new OpenClawAdapter(apiKey, adapterOptions);
    // Configure engine
    const engineOptions = {
        maxConcurrency: args.maxConcurrency ?? 3,
        verbose: args.verbose ?? false,
        enableCheckpoints: true
    };
    const engine = new DevEngine(adapter, engineOptions);
    // Setup event logging if not in verbose mode (verbose mode uses ConsoleEventLogger internally)
    if (!args.verbose) {
        engine.events.on('phase:start', async (e) => {
            console.log(`\n📋 Phase: ${e.data.phase}`);
        });
        engine.events.on('task:complete', async (e) => {
            console.log(`✅ Completed: ${e.data.taskId}`);
        });
        engine.events.on('task:failed', async (e) => {
            console.log(`❌ Failed: ${e.data.taskId}`);
        });
    }
    // Progress indicator
    engine.progress.onProgress((progress) => {
        if (progress.totalTasks > 0) {
            process.stdout.write(`\r[${progress.percentage}%] ${progress.completedTasks}/${progress.totalTasks} tasks`);
        }
    });
    // Execute
    console.log('\n🚀 OpenClaw DevEngine Starting...\n');
    console.log(`Goal: ${args.goal}`);
    if (args.repoPath) {
        console.log(`Context: ${args.repoPath}`);
    }
    if (args.resume) {
        console.log('Mode: Resume from checkpoint');
    }
    console.log('');
    try {
        const result = await engine.run(args.goal, args.repoPath, args.resume);
        console.log('\n\n' + result);
        // Print summary
        const status = engine.progress.getProgress();
        console.log(`\n📊 Summary:`);
        console.log(`   Tasks completed: ${status.completedTasks}`);
        console.log(`   Tasks failed: ${status.failedTasks}`);
    }
    catch (error) {
        console.error('\n\n❌ DevEngine Failed:', error);
        process.exit(1);
    }
}
// =============================================================================
// Entry Point
// =============================================================================
main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
