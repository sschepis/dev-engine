// =============================================================================
// OpenClaw DevEngine - Mock Adapters for Testing
// =============================================================================

import { jest } from '@jest/globals';
import {
  IEnvironmentAdapter,
  IFileSystem,
  IShellAdapter,
  ILLMProvider,
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
  LogLevel
} from '../../src/interfaces/index.js';

// =============================================================================
// Mock File System
// =============================================================================

export class MockFileSystem implements IFileSystem {
  private files: Map<string, string | Buffer> = new Map();
  private directories: Set<string> = new Set(['/']);

  // Track calls for assertions
  calls = {
    readFile: [] as string[],
    writeFile: [] as Array<{ path: string; content: string | Buffer }>,
    exists: [] as string[],
    delete: [] as string[],
    mkdir: [] as string[],
    listFiles: [] as string[]
  };

  // Pre-seed files for tests
  seedFile(path: string, content: string | Buffer): void {
    this.files.set(path, content);
    // Ensure parent directories exist
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      this.directories.add(parts.slice(0, i).join('/') || '/');
    }
  }

  seedDirectory(path: string): void {
    this.directories.add(path);
  }

  async readFile(path: string): Promise<string> {
    this.calls.readFile.push(path);
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return typeof content === 'string' ? content : content.toString('utf-8');
  }

  async readFileBuffer(path: string): Promise<Buffer> {
    this.calls.readFile.push(path);
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return Buffer.isBuffer(content) ? content : Buffer.from(content);
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.calls.writeFile.push({ path, content });
    this.files.set(path, content);
    
    // Ensure parent directories exist
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      this.directories.add(parts.slice(0, i).join('/') || '/');
    }
  }

  async exists(path: string): Promise<boolean> {
    this.calls.exists.push(path);
    return this.files.has(path) || this.directories.has(path);
  }

  async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    this.calls.mkdir.push(path);
    this.directories.add(path);
  }

  async delete(path: string, _options?: { recursive?: boolean }): Promise<void> {
    this.calls.delete.push(path);
    this.files.delete(path);
    this.directories.delete(path);
  }

  async listFiles(dir: string, options: ListFilesOptions = {}): Promise<string[]> {
    this.calls.listFiles.push(dir);
    
    const results: string[] = [];
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    
    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const relative = path.slice(prefix.length);
        if (!options.recursive && relative.includes('/')) continue;
        if (options.include && !options.include.test(relative)) continue;
        if (options.exclude && options.exclude.test(relative)) continue;
        results.push(relative);
      }
    }
    
    return results;
  }

  async stat(path: string): Promise<FileInfo> {
    const content = this.files.get(path);
    const isDir = this.directories.has(path);
    
    if (!content && !isDir) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
    
    return {
      path,
      isDirectory: isDir,
      size: content ? (typeof content === 'string' ? content.length : content.length) : 0,
      modified: new Date()
    };
  }

  async copy(src: string, dest: string): Promise<void> {
    const content = await this.readFile(src);
    await this.writeFile(dest, content);
  }

  async move(src: string, dest: string): Promise<void> {
    await this.copy(src, dest);
    await this.delete(src);
  }

  // Test helpers
  getWrittenContent(path: string): string | Buffer | undefined {
    return this.files.get(path);
  }

  reset(): void {
    this.files.clear();
    this.directories.clear();
    this.directories.add('/');
    this.calls = {
      readFile: [],
      writeFile: [],
      exists: [],
      delete: [],
      mkdir: [],
      listFiles: []
    };
  }
}

// =============================================================================
// Mock Shell Adapter
// =============================================================================

export class MockShellAdapter implements IShellAdapter {
  private commandResponses: Map<string, ExecResult> = new Map();
  private testResults: Map<string, TestResult> = new Map();
  
  calls = {
    exec: [] as Array<{ command: string; options?: ExecOptions }>,
    spawn: [] as Array<{ command: string; args: string[] }>
  };

  // Configure responses
  setCommandResponse(command: string | RegExp, response: Partial<ExecResult>): void {
    const key = command instanceof RegExp ? command.source : command;
    this.commandResponses.set(key, {
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      exitCode: response.exitCode ?? 0,
      ...response
    });
  }

  setTestResult(testFile: string, result: Partial<TestResult>): void {
    this.testResults.set(testFile, {
      passed: result.passed ?? true,
      numPassed: result.numPassed ?? 1,
      numFailed: result.numFailed ?? 0,
      numSkipped: result.numSkipped ?? 0,
      failures: result.failures ?? [],
      duration: result.duration ?? 100,
      rawOutput: result.rawOutput ?? 'Tests passed'
    });
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.calls.exec.push({ command, options });
    
    // Check for exact match first
    if (this.commandResponses.has(command)) {
      return this.commandResponses.get(command)!;
    }
    
    // Check for regex matches
    for (const [pattern, response] of this.commandResponses.entries()) {
      if (new RegExp(pattern).test(command)) {
        return response;
      }
    }
    
    // Default success response
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  async *spawn(command: string, args: string[], _options?: SpawnOptions): AsyncIterable<ShellEvent> {
    this.calls.spawn.push({ command, args });
    yield { type: 'exit', exitCode: 0 };
  }

  getTestRunner(): TestRunner {
    return new MockTestRunner(this.testResults);
  }

  async which(command: string): Promise<string | null> {
    return `/usr/bin/${command}`;
  }

  reset(): void {
    this.commandResponses.clear();
    this.testResults.clear();
    this.calls = { exec: [], spawn: [] };
  }
}

class MockTestRunner implements TestRunner {
  name = 'mock-jest';

  constructor(private results: Map<string, TestResult>) {}

  async run(testFile: string, _options?: ExecOptions): Promise<TestResult> {
    if (this.results.has(testFile)) {
      return this.results.get(testFile)!;
    }
    
    // Default passing test
    return {
      passed: true,
      numPassed: 1,
      numFailed: 0,
      numSkipped: 0,
      failures: [],
      duration: 100,
      rawOutput: 'PASS'
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

// =============================================================================
// Mock LLM Provider
// =============================================================================

export class MockLLMProvider implements ILLMProvider {
  private responses: Array<{ match: (req: LLMRequest) => boolean; response: string }> = [];
  private defaultResponse = 'Mock LLM response';
  
  calls = {
    generate: [] as LLMRequest[],
    generateWithMeta: [] as LLMRequest[],
    embed: [] as string[]
  };

  // Configure responses
  setResponse(response: string): void {
    this.defaultResponse = response;
  }

  addConditionalResponse(match: (req: LLMRequest) => boolean, response: string): void {
    this.responses.push({ match, response });
  }

  addPromptMatch(promptContains: string, response: string): void {
    this.addConditionalResponse(
      (req) => req.systemPrompt.includes(promptContains) || 
               req.userPrompt?.includes(promptContains) || false,
      response
    );
  }

  async generate(request: LLMRequest): Promise<string> {
    this.calls.generate.push(request);
    
    // Check conditional responses
    for (const { match, response } of this.responses) {
      if (match(request)) {
        return response;
      }
    }
    
    return this.defaultResponse;
  }

  async generateWithMeta(request: LLMRequest): Promise<LLMResponse> {
    this.calls.generateWithMeta.push(request);
    const content = await this.generate(request);
    
    return {
      content,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      }
    };
  }

  async *generateStream(request: LLMRequest): AsyncIterable<StreamChunk> {
    const response = await this.generate(request);
    
    // Yield response in chunks
    const words = response.split(' ');
    for (const word of words) {
      yield { type: 'text', content: word + ' ' };
    }
    yield { type: 'done' };
  }

  async embed(text: string): Promise<number[]> {
    this.calls.embed.push(text);
    // Return a simple hash-based embedding for testing
    const hash = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return Array.from({ length: 10 }, (_, i) => Math.sin(hash + i));
  }

  reset(): void {
    this.responses = [];
    this.defaultResponse = 'Mock LLM response';
    this.calls = { generate: [], generateWithMeta: [], embed: [] };
  }
}

// =============================================================================
// Mock Logger
// =============================================================================

export class MockLogger implements ILogger {
  logs: Array<{ level: LogLevel; message: string; context?: Record<string, unknown> }> = [];

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
    this.logs.push({ level, message, context });
  }

  // Test helpers
  hasLogMatching(level: LogLevel, pattern: string | RegExp): boolean {
    return this.logs.some(
      log => log.level === level && 
             (typeof pattern === 'string' ? log.message.includes(pattern) : pattern.test(log.message))
    );
  }

  reset(): void {
    this.logs = [];
  }
}

// =============================================================================
// Complete Mock Adapter
// =============================================================================

export class MockEnvironmentAdapter implements IEnvironmentAdapter {
  fs: MockFileSystem;
  shell: MockShellAdapter;
  llm: MockLLMProvider;
  logger: MockLogger;

  constructor() {
    this.fs = new MockFileSystem();
    this.shell = new MockShellAdapter();
    this.llm = new MockLLMProvider();
    this.logger = new MockLogger();
  }

  log(message: string, level: LogLevel = 'info'): void {
    this.logger.log(level, message);
  }

  reset(): void {
    this.fs.reset();
    this.shell.reset();
    this.llm.reset();
    this.logger.reset();
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createMockAdapter(): MockEnvironmentAdapter {
  return new MockEnvironmentAdapter();
}

export function createMockFS(): MockFileSystem {
  return new MockFileSystem();
}

export function createMockShell(): MockShellAdapter {
  return new MockShellAdapter();
}

export function createMockLLM(): MockLLMProvider {
  return new MockLLMProvider();
}

export function createMockLogger(): MockLogger {
  return new MockLogger();
}
