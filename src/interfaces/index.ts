// =============================================================================
// OpenClaw DevEngine - Interface Definitions
// =============================================================================

// -----------------------------------------------------------------------------
// LLM Interfaces
// -----------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

export interface LLMRequest {
  systemPrompt: string;
  userPrompt?: string;
  messages?: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  tools?: ToolDefinition[];
  images?: Buffer[];
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ILLMProvider {
  generate(request: LLMRequest): Promise<string>;
  generateWithMeta(request: LLMRequest): Promise<LLMResponse>;
  generateStream?(request: LLMRequest): AsyncIterable<StreamChunk>;
  embed?(text: string): Promise<number[]>;
}

// -----------------------------------------------------------------------------
// File System Interfaces
// -----------------------------------------------------------------------------

export interface FileInfo {
  path: string;
  isDirectory: boolean;
  size: number;
  modified: Date;
}

export interface ListFilesOptions {
  recursive?: boolean;
  include?: RegExp;
  exclude?: RegExp;
  maxDepth?: number;
}

export interface IFileSystem {
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Buffer>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
  listFiles(dir: string, options?: ListFilesOptions): Promise<string[]>;
  stat(path: string): Promise<FileInfo>;
  copy(src: string, dest: string): Promise<void>;
  move(src: string, dest: string): Promise<void>;
}

// -----------------------------------------------------------------------------
// Shell Interfaces
// -----------------------------------------------------------------------------

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  timedOut?: boolean;
}

export type ShellEventType = 'stdout' | 'stderr' | 'exit' | 'error';

export interface ShellEvent {
  type: ShellEventType;
  data?: string;
  exitCode?: number;
  error?: Error;
}

export interface SpawnOptions extends ExecOptions {
  shell?: boolean;
  detached?: boolean;
}

export interface TestResult {
  passed: boolean;
  numPassed: number;
  numFailed: number;
  numSkipped: number;
  failures: TestFailure[];
  duration: number;
  rawOutput: string;
}

export interface TestFailure {
  testName: string;
  message: string;
  expected?: string;
  actual?: string;
  stack?: string;
}

export interface TestRunner {
  name: string;
  run(testFile: string, options?: ExecOptions): Promise<TestResult>;
  isAvailable(): Promise<boolean>;
}

export interface IShellAdapter {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  spawn(command: string, args: string[], options?: SpawnOptions): AsyncIterable<ShellEvent>;
  getTestRunner(): TestRunner;
  which(command: string): Promise<string | null>;
}

// -----------------------------------------------------------------------------
// Image Interfaces
// -----------------------------------------------------------------------------

export interface ScreenshotOptions {
  url?: string;
  selector?: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
}

export interface ImageDiff {
  identical: boolean;
  diffPercentage: number;
  diffPixels: number;
  diffImage?: Buffer;
}

export interface IImageAdapter {
  screenshot(options: ScreenshotOptions): Promise<Buffer>;
  compare(expected: Buffer, actual: Buffer, threshold?: number): Promise<ImageDiff>;
  resize(image: Buffer, width: number, height: number): Promise<Buffer>;
}

// -----------------------------------------------------------------------------
// Logging Interfaces
// -----------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

// -----------------------------------------------------------------------------
// Environment Adapter Interface
// -----------------------------------------------------------------------------

export interface IEnvironmentAdapter {
  fs: IFileSystem;
  shell: IShellAdapter;
  llm: ILLMProvider;
  images?: IImageAdapter;
  logger: ILogger;
  
  // Convenience method for simple logging
  log(message: string, level?: LogLevel): void;
}

// -----------------------------------------------------------------------------
// Skill Interfaces
// -----------------------------------------------------------------------------

export interface RequiredCapabilities {
  llm: boolean;
  filesystem?: boolean;
  shell?: boolean;
  images?: boolean;
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  default?: unknown;
}

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: string[];
  requires: RequiredCapabilities;
  parameters: SkillParameter[];
  invocation: {
    cli?: string;
    api?: string;
  };
}

export interface SkillContext {
  adapter: IEnvironmentAdapter;
  parameters: Record<string, unknown>;
  workingDirectory: string;
  checkpointDir?: string;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  artifacts?: string[];
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface ISkill {
  manifest: SkillManifest;
  execute(context: SkillContext): Promise<SkillResult>;
  validate?(context: SkillContext): Promise<string[]>;
  estimateCost?(context: SkillContext): Promise<{ tokens: number; cost: number }>;
}

// -----------------------------------------------------------------------------
// State Management Interfaces
// -----------------------------------------------------------------------------

export interface TaskState {
  id: string;
  filePath: string;
  description: string;
  dependencies: string[];
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  result?: string;
  error?: string;
  attempts: number;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExecutionState {
  planId: string;
  goal: string;
  phase: 'planning' | 'executing' | 'documenting' | 'completed' | 'failed';
  tasks: TaskState[];
  architectureReasoning: string;
  startedAt: Date;
  lastCheckpoint: Date;
  metadata?: Record<string, unknown>;
}

export interface IStateManager {
  save(state: ExecutionState): Promise<void>;
  load(planId: string): Promise<ExecutionState | null>;
  list(): Promise<string[]>;
  delete(planId: string): Promise<void>;
  exists(planId: string): Promise<boolean>;
}

// -----------------------------------------------------------------------------
// Error Classification Interfaces
// -----------------------------------------------------------------------------

export type ErrorCategory = 
  | 'syntax'       // Code won't parse
  | 'type'         // Type errors
  | 'import'       // Missing imports/modules
  | 'runtime'      // Runtime exceptions
  | 'assertion'    // Test assertion failures
  | 'timeout'      // Operation timed out
  | 'permission'   // Permission denied
  | 'resource'     // Resource not found
  | 'network'      // Network errors
  | 'unknown';     // Unclassified

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
  originalError: string;
}

export interface IErrorClassifier {
  classify(stderr: string, exitCode: number): ClassifiedError;
  getFixStrategy(category: ErrorCategory): string;
}

// -----------------------------------------------------------------------------
// Event System Interfaces
// -----------------------------------------------------------------------------

export type EngineEventType = 
  | 'engine:start'
  | 'engine:complete'
  | 'engine:error'
  | 'phase:start'
  | 'phase:complete'
  | 'task:start'
  | 'task:progress'
  | 'task:complete'
  | 'task:failed'
  | 'task:retry'
  | 'llm:request'
  | 'llm:response'
  | 'llm:stream'
  | 'checkpoint:saved'
  | 'checkpoint:restored';

export interface EngineEvent {
  type: EngineEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type EventHandler = (event: EngineEvent) => void | Promise<void>;

export interface IEventEmitter {
  on(event: EngineEventType, handler: EventHandler): void;
  off(event: EngineEventType, handler: EventHandler): void;
  emit(event: EngineEventType, data: Record<string, unknown>): Promise<void>;
  once(event: EngineEventType, handler: EventHandler): void;
}
