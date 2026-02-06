// =============================================================================
// OpenClaw DevEngine - OpenClaw Environment Adapter
// =============================================================================

import {
  IEnvironmentAdapter,
  IFileSystem,
  IShellAdapter,
  ILLMProvider,
  IImageAdapter,
  ILogger,
  LLMRequest,
  LLMResponse,
  StreamChunk,
  FileInfo,
  ListFilesOptions,
  ExecOptions,
  ExecResult,
  SpawnOptions,
  ShellEvent,
  TestRunner,
  TestResult,
  TestFailure,
  ScreenshotOptions,
  ImageDiff,
  LogLevel,
  LogEntry
} from '../interfaces/index.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// =============================================================================
// File System Implementation
// =============================================================================

export class OpenClawFS implements IFileSystem {
  constructor(private basePath: string = process.cwd()) {}

  private resolve(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.basePath, filePath);
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(this.resolve(filePath), 'utf-8');
  }

  async readFileBuffer(filePath: string): Promise<Buffer> {
    return fs.readFile(this.resolve(filePath));
  }

  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    const resolved = this.resolve(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, typeof content === 'string' ? 'utf-8' : undefined);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolve(dirPath), { recursive: options?.recursive ?? true });
  }

  async delete(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolve(filePath);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: options?.recursive ?? false });
    } else {
      await fs.unlink(resolved);
    }
  }

  async listFiles(dir: string, options: ListFilesOptions = {}): Promise<string[]> {
    const resolved = this.resolve(dir);
    
    const collect = async (currentDir: string, depth: number): Promise<string[]> => {
      if (options.maxDepth !== undefined && depth > options.maxDepth) {
        return [];
      }

      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      const results: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(resolved, fullPath);

        // Apply filters
        if (options.exclude?.test(relativePath)) continue;
        if (options.include && !options.include.test(relativePath)) continue;

        // Skip common non-essential directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;

        if (entry.isDirectory()) {
          if (options.recursive) {
            results.push(...await collect(fullPath, depth + 1));
          }
        } else {
          results.push(relativePath);
        }
      }

      return results;
    };

    try {
      return await collect(resolved, 0);
    } catch {
      return [];
    }
  }

  async stat(filePath: string): Promise<FileInfo> {
    const resolved = this.resolve(filePath);
    const stats = await fs.stat(resolved);
    return {
      path: filePath,
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modified: stats.mtime
    };
  }

  async copy(src: string, dest: string): Promise<void> {
    const srcResolved = this.resolve(src);
    const destResolved = this.resolve(dest);
    const destDir = path.dirname(destResolved);
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(srcResolved, destResolved);
  }

  async move(src: string, dest: string): Promise<void> {
    const srcResolved = this.resolve(src);
    const destResolved = this.resolve(dest);
    const destDir = path.dirname(destResolved);
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(srcResolved, destResolved);
  }
}

// =============================================================================
// Shell Adapter Implementation
// =============================================================================

export class OpenClawShell implements IShellAdapter {
  private testRunnerCache: TestRunner | null = null;

  constructor(private cwd: string = process.cwd()) {}

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options.cwd ?? this.cwd,
        env: { ...process.env, ...options.env },
        timeout: options.timeout,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024  // 10MB default
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code ?? 1,
        signal: error.signal,
        timedOut: error.killed
      };
    }
  }

  async *spawn(
    command: string,
    args: string[],
    options: SpawnOptions = {}
  ): AsyncIterable<ShellEvent> {
    const proc = spawn(command, args, {
      cwd: options.cwd ?? this.cwd,
      env: { ...process.env, ...options.env },
      shell: options.shell ?? true,
      detached: options.detached
    });

    const eventQueue: ShellEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    proc.stdout?.on('data', (data: Buffer) => {
      eventQueue.push({ type: 'stdout', data: data.toString() });
      resolveWait?.();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      eventQueue.push({ type: 'stderr', data: data.toString() });
      resolveWait?.();
    });

    proc.on('error', (error: Error) => {
      eventQueue.push({ type: 'error', error });
      resolveWait?.();
    });

    proc.on('exit', (code: number | null, signal: string | null) => {
      eventQueue.push({ type: 'exit', exitCode: code ?? undefined });
      done = true;
      resolveWait?.();
    });

    while (!done || eventQueue.length > 0) {
      if (eventQueue.length === 0) {
        await new Promise<void>(resolve => {
          resolveWait = resolve;
        });
      }
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
    }
  }

  getTestRunner(): TestRunner {
    if (this.testRunnerCache) {
      return this.testRunnerCache;
    }

    // Auto-detect test runner
    this.testRunnerCache = this.detectTestRunner();
    return this.testRunnerCache;
  }

  private detectTestRunner(): TestRunner {
    // Check for common test runners in order of preference
    const runners: Array<{ name: string; check: string; runner: TestRunner }> = [
      {
        name: 'vitest',
        check: 'node_modules/.bin/vitest',
        runner: new VitestRunner(this.cwd)
      },
      {
        name: 'jest',
        check: 'node_modules/.bin/jest',
        runner: new JestRunner(this.cwd)
      },
      {
        name: 'mocha',
        check: 'node_modules/.bin/mocha',
        runner: new MochaRunner(this.cwd)
      }
    ];

    for (const { check, runner } of runners) {
      const fullPath = path.join(this.cwd, check);
      if (fsSync.existsSync(fullPath)) {
        return runner;
      }
    }

    // Default to Jest via npx
    return new JestRunner(this.cwd);
  }

  async which(command: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec(`which ${command}`);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Test Runner Implementations
// =============================================================================

class JestRunner implements TestRunner {
  name = 'jest';

  constructor(private cwd: string) {}

  async run(testFile: string, options?: ExecOptions): Promise<TestResult> {
    const shell = new OpenClawShell(this.cwd);
    const result = await shell.exec(
      `npx jest "${testFile}" --json --runInBand`,
      options
    );

    return this.parseResult(result);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const shell = new OpenClawShell(this.cwd);
      const result = await shell.exec('npx jest --version');
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private parseResult(result: ExecResult): TestResult {
    // Try to parse JSON output
    try {
      const jsonMatch = result.stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return {
          passed: json.success,
          numPassed: json.numPassedTests || 0,
          numFailed: json.numFailedTests || 0,
          numSkipped: json.numPendingTests || 0,
          failures: this.extractJestFailures(json),
          duration: json.testResults?.[0]?.endTime - json.testResults?.[0]?.startTime || 0,
          rawOutput: result.stdout + result.stderr
        };
      }
    } catch {
      // Fall through to basic parsing
    }

    // Basic parsing fallback
    const passed = result.exitCode === 0;
    return {
      passed,
      numPassed: passed ? 1 : 0,
      numFailed: passed ? 0 : 1,
      numSkipped: 0,
      failures: passed ? [] : [{ testName: 'unknown', message: result.stderr }],
      duration: 0,
      rawOutput: result.stdout + result.stderr
    };
  }

  private extractJestFailures(json: any): TestFailure[] {
    const failures: TestFailure[] = [];
    
    for (const testResult of json.testResults || []) {
      for (const assertionResult of testResult.assertionResults || []) {
        if (assertionResult.status === 'failed') {
          failures.push({
            testName: assertionResult.fullName || assertionResult.title,
            message: assertionResult.failureMessages?.join('\n') || 'Unknown failure',
            stack: assertionResult.failureDetails?.[0]?.stack
          });
        }
      }
    }
    
    return failures;
  }
}

class VitestRunner implements TestRunner {
  name = 'vitest';

  constructor(private cwd: string) {}

  async run(testFile: string, options?: ExecOptions): Promise<TestResult> {
    const shell = new OpenClawShell(this.cwd);
    const result = await shell.exec(
      `npx vitest run "${testFile}" --reporter=json`,
      options
    );

    return this.parseResult(result);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const shell = new OpenClawShell(this.cwd);
      const result = await shell.exec('npx vitest --version');
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private parseResult(result: ExecResult): TestResult {
    const passed = result.exitCode === 0;
    
    // Vitest JSON parsing
    try {
      const jsonMatch = result.stdout.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        return {
          passed,
          numPassed: json.numPassedTests || 0,
          numFailed: json.numFailedTests || 0,
          numSkipped: json.numSkippedTests || 0,
          failures: [],  // TODO: Extract failures from vitest JSON
          duration: json.duration || 0,
          rawOutput: result.stdout + result.stderr
        };
      }
    } catch {
      // Fall through
    }

    return {
      passed,
      numPassed: passed ? 1 : 0,
      numFailed: passed ? 0 : 1,
      numSkipped: 0,
      failures: passed ? [] : [{ testName: 'unknown', message: result.stderr }],
      duration: 0,
      rawOutput: result.stdout + result.stderr
    };
  }
}

class MochaRunner implements TestRunner {
  name = 'mocha';

  constructor(private cwd: string) {}

  async run(testFile: string, options?: ExecOptions): Promise<TestResult> {
    const shell = new OpenClawShell(this.cwd);
    const result = await shell.exec(
      `npx mocha "${testFile}" --reporter json`,
      options
    );

    return this.parseResult(result);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const shell = new OpenClawShell(this.cwd);
      const result = await shell.exec('npx mocha --version');
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private parseResult(result: ExecResult): TestResult {
    const passed = result.exitCode === 0;
    
    try {
      const json = JSON.parse(result.stdout);
      return {
        passed,
        numPassed: json.stats?.passes || 0,
        numFailed: json.stats?.failures || 0,
        numSkipped: json.stats?.pending || 0,
        failures: (json.failures || []).map((f: any) => ({
          testName: f.fullTitle,
          message: f.err?.message || 'Unknown error'
        })),
        duration: json.stats?.duration || 0,
        rawOutput: result.stdout + result.stderr
      };
    } catch {
      return {
        passed,
        numPassed: passed ? 1 : 0,
        numFailed: passed ? 0 : 1,
        numSkipped: 0,
        failures: passed ? [] : [{ testName: 'unknown', message: result.stderr }],
        duration: 0,
        rawOutput: result.stdout + result.stderr
      };
    }
  }
}

// =============================================================================
// LLM Provider Implementation
// =============================================================================

export class OpenClawLLM implements ILLMProvider {
  private tokenUsage = { input: 0, output: 0 };

  constructor(
    private apiKey: string,
    private defaultModel: string = 'gpt-4-turbo-preview',
    private baseUrl: string = 'https://api.openai.com/v1'
  ) {}

  async generate(request: LLMRequest): Promise<string> {
    const response = await this.generateWithMeta(request);
    return response.content;
  }

  async generateWithMeta(request: LLMRequest): Promise<LLMResponse> {
    const messages = this.buildMessages(request);
    
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens
    };

    if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    
    // Track usage
    if (data.usage) {
      this.tokenUsage.input += data.usage.prompt_tokens || 0;
      this.tokenUsage.output += data.usage.completion_tokens || 0;
    }

    const choice = data.choices[0];
    
    return {
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      })),
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }

  async *generateStream(request: LLMRequest): AsyncIterable<StreamChunk> {
    const messages = this.buildMessages(request);
    
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages,
      temperature: request.temperature ?? 0.1,
      stream: true
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `LLM API Error: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield { type: 'text', content };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    yield { type: 'done' };
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding API Error: ${await response.text()}`);
    }

    const data = await response.json() as any;
    return data.data[0].embedding;
  }

  getTokenUsage(): { input: number; output: number; total: number } {
    return {
      ...this.tokenUsage,
      total: this.tokenUsage.input + this.tokenUsage.output
    };
  }

  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    
    messages.push({ role: 'system', content: request.systemPrompt });
    
    if (request.messages) {
      for (const msg of request.messages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    if (request.userPrompt) {
      messages.push({ role: 'user', content: request.userPrompt });
    }
    
    return messages;
  }
}

// =============================================================================
// Logger Implementation
// =============================================================================

export class OpenClawLogger implements ILogger {
  private entries: LogEntry[] = [];
  private maxEntries: number;

  constructor(
    private prefix: string = 'OpenClaw',
    options: { maxEntries?: number } = {}
  ) {
    this.maxEntries = options.maxEntries ?? 1000;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    const prefix = `[${this.prefix}]`;
    const timestamp = entry.timestamp.toISOString();
    const formatted = `${prefix} ${timestamp} [${level.toUpperCase()}] ${message}`;

    switch (level) {
      case 'debug':
        console.debug(formatted, context || '');
        break;
      case 'info':
        console.log(formatted, context || '');
        break;
      case 'warn':
        console.warn(formatted, context || '');
        break;
      case 'error':
        console.error(formatted, context || '');
        break;
    }
  }

  getEntries(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.entries.filter(e => e.level === level);
    }
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

// =============================================================================
// Main Adapter
// =============================================================================

export interface OpenClawAdapterOptions {
  model?: string;
  baseUrl?: string;
  basePath?: string;
  logPrefix?: string;
}

export class OpenClawAdapter implements IEnvironmentAdapter {
  readonly fs: IFileSystem;
  readonly shell: IShellAdapter;
  readonly llm: ILLMProvider;
  readonly images?: IImageAdapter;
  readonly logger: ILogger;

  constructor(apiKey: string, options: OpenClawAdapterOptions = {}) {
    const basePath = options.basePath ?? process.cwd();
    
    this.fs = new OpenClawFS(basePath);
    this.shell = new OpenClawShell(basePath);
    this.llm = new OpenClawLLM(
      apiKey,
      options.model ?? 'gpt-4-turbo-preview',
      options.baseUrl ?? 'https://api.openai.com/v1'
    );
    this.logger = new OpenClawLogger(options.logPrefix ?? 'OpenClaw');
    // Images adapter is optional - can be added later
  }

  /**
   * Convenience method for simple logging (backward compatibility)
   */
  log(message: string, level: LogLevel = 'info'): void {
    this.logger.log(level, message);
  }
}
