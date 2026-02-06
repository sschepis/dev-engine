// =============================================================================
// OpenClaw DevEngine - Main Engine Core
// =============================================================================

import { 
  IEnvironmentAdapter, 
  ISkill, 
  SkillManifest, 
  SkillContext, 
  SkillResult,
  ExecutionState,
  TaskState,
  ErrorCategory 
} from '../interfaces/index.js';
import { TaskScheduler, Task, SchedulerOptions } from './TaskScheduler.js';
import { StateManager } from './StateManager.js';
import { ErrorClassifier, errorClassifier } from './ErrorClassifier.js';
import { InterfaceExtractor } from './InterfaceExtractor.js';
import { EngineEventEmitter, ProgressTracker, ConsoleEventLogger } from './EventEmitter.js';
import { PROMPTS, getFixerPrompt } from '../skills/prompts.js';

// =============================================================================
// Types
// =============================================================================

export interface TaskDefinition {
  id: string;
  file_path: string;
  description: string;
  dependencies: string[];
  type: 'code' | 'test' | 'config' | 'docs';
  priority?: number;
}

export interface ImplementationPlan {
  tasks: TaskDefinition[];
  architecture_reasoning: string;
}

export interface DevEngineOptions {
  maxConcurrency?: number;
  maxRetries?: number;
  enableCheckpoints?: boolean;
  checkpointDir?: string;
  verbose?: boolean;
  testTimeout?: number;
}

// =============================================================================
// DevEngine Skill Implementation
// =============================================================================

export class DevEngine implements ISkill {
  private scheduler: TaskScheduler;
  private stateManager: StateManager;
  private extractor: InterfaceExtractor;
  private currentState: ExecutionState | null = null;
  private options: Required<DevEngineOptions>;
  
  readonly events: EngineEventEmitter;
  readonly progress: ProgressTracker;

  readonly manifest: SkillManifest = {
    id: 'openclaw.dev-engine',
    name: 'Development Engine',
    version: '2.0.0',
    description: 'State-machine-driven agentic workflow for software development. Automates Analysis, Planning, Implementation, Verification, and Documentation.',
    author: 'OpenClaw',
    capabilities: [
      'code-generation',
      'test-generation', 
      'documentation',
      'self-healing',
      'parallel-execution'
    ],
    requires: {
      llm: true,
      filesystem: true,
      shell: true,
      images: false
    },
    parameters: [
      {
        name: 'goal',
        type: 'string',
        required: true,
        description: 'Natural language description of what to build'
      },
      {
        name: 'repoPath',
        type: 'string',
        required: false,
        description: 'Path to existing codebase for context'
      },
      {
        name: 'resume',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Whether to resume from a previous checkpoint'
      }
    ],
    invocation: {
      cli: 'dev-engine <goal> [repo-path]',
      api: 'DevEngine.execute(goal, repoPath)'
    }
  };

  constructor(
    private adapter: IEnvironmentAdapter,
    options: DevEngineOptions = {}
  ) {
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 3,
      maxRetries: options.maxRetries ?? 3,
      enableCheckpoints: options.enableCheckpoints ?? true,
      checkpointDir: options.checkpointDir ?? '.openclaw/state',
      verbose: options.verbose ?? false,
      testTimeout: options.testTimeout ?? 60000
    };

    // Initialize components
    this.events = new EngineEventEmitter();
    this.progress = new ProgressTracker(this.events);
    this.extractor = new InterfaceExtractor();
    this.stateManager = new StateManager(adapter.fs, { 
      stateDir: this.options.checkpointDir 
    });

    // Setup scheduler
    const schedulerOpts: SchedulerOptions = {
      maxConcurrency: this.options.maxConcurrency,
      defaultMaxAttempts: this.options.maxRetries,
      taskTimeout: this.options.testTimeout * 2
    };
    this.scheduler = new TaskScheduler(
      adapter, 
      this.executeTaskLogic.bind(this),
      schedulerOpts
    );

    // Setup console logging if verbose
    if (this.options.verbose) {
      new ConsoleEventLogger(this.events, true);
    }
  }

  // ===========================================================================
  // ISkill Implementation
  // ===========================================================================

  async execute(context: SkillContext): Promise<SkillResult> {
    const goal = context.parameters.goal as string;
    const repoPath = context.parameters.repoPath as string | undefined;
    const resume = context.parameters.resume as boolean | undefined;

    try {
      const result = await this.run(goal, repoPath, resume);
      return {
        success: true,
        output: result,
        artifacts: this.getGeneratedFiles(),
        metadata: {
          planId: this.currentState?.planId,
          tasksCompleted: this.currentState?.tasks.filter(t => t.status === 'COMPLETED').length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          planId: this.currentState?.planId,
          phase: this.currentState?.phase
        }
      };
    }
  }

  async validate(context: SkillContext): Promise<string[]> {
    const errors: string[] = [];
    
    if (!context.parameters.goal || typeof context.parameters.goal !== 'string') {
      errors.push('Parameter "goal" is required and must be a string');
    }
    
    if (context.parameters.repoPath && typeof context.parameters.repoPath !== 'string') {
      errors.push('Parameter "repoPath" must be a string if provided');
    }
    
    return errors;
  }

  async estimateCost(context: SkillContext): Promise<{ tokens: number; cost: number }> {
    // Rough estimation based on goal complexity
    const goal = (context.parameters.goal as string) || '';
    const baseTokens = 10000; // Base overhead
    const complexityMultiplier = Math.ceil(goal.length / 100);
    const estimatedTokens = baseTokens * (1 + complexityMultiplier);
    
    // Assuming ~$0.01 per 1K tokens (varies by model)
    const cost = (estimatedTokens / 1000) * 0.01;
    
    return { tokens: estimatedTokens, cost };
  }

  // ===========================================================================
  // Main Execution Flow
  // ===========================================================================

  /**
   * Main entry point - execute the development workflow
   */
  async run(goal: string, repoPath?: string, resume?: boolean): Promise<string> {
    this.adapter.log(`Starting DevEngine for: ${goal}`);

    // Check for existing checkpoint if resume requested
    if (resume && this.options.enableCheckpoints) {
      const existingState = await this.stateManager.findLatestForGoal(goal);
      if (existingState && !StateManager.isComplete(existingState)) {
        this.adapter.log('Resuming from checkpoint...');
        return this.resumeExecution(existingState);
      }
    }

    // Initialize new execution state
    this.currentState = StateManager.createInitialState(goal);
    await this.checkpoint();

    try {
      // Phase 1: Context Gathering
      await this.events.emit('phase:start', { phase: 'context-gathering' });
      const context = repoPath ? await this.analyzeCodebase(repoPath) : '';

      // Phase 2: Architecture Planning
      await this.events.emit('phase:start', { phase: 'planning' });
      this.currentState.phase = 'planning';
      const plan = await this.phaseArchitect(goal, context);
      this.currentState.architectureReasoning = plan.architecture_reasoning;
      
      this.adapter.log(`Plan generated with ${plan.tasks.length} tasks`);

      // Phase 3: Convert to scheduler tasks
      const schedulerTasks = this.convertPlanToTasks(plan);
      this.currentState.tasks = schedulerTasks.map(t => ({
        id: t.id,
        filePath: t.filePath,
        description: t.description,
        dependencies: t.dependencies,
        status: 'PENDING' as const,
        attempts: 0
      }));
      await this.checkpoint();

      // Phase 4: Parallel Execution
      await this.events.emit('phase:start', { phase: 'execution' });
      this.currentState.phase = 'executing';
      this.scheduler.loadPlan(schedulerTasks);
      await this.scheduler.run();

      // Phase 5: Documentation
      await this.events.emit('phase:start', { phase: 'documentation' });
      this.currentState.phase = 'documenting';
      await this.phaseDocument(plan);

      // Complete
      this.currentState.phase = 'completed';
      await this.checkpoint();

      return 'Development cycle complete.';

    } catch (error) {
      this.currentState.phase = 'failed';
      await this.checkpoint();
      throw error;
    }
  }

  /**
   * Resume execution from a checkpoint
   */
  private async resumeExecution(state: ExecutionState): Promise<string> {
    this.currentState = state;
    
    // Get completed results
    const completedResults = new Map<string, string>();
    for (const task of state.tasks) {
      if (task.status === 'COMPLETED' && task.result) {
        completedResults.set(task.id, task.result);
      }
    }

    // Convert state tasks back to scheduler tasks
    const schedulerTasks: Task[] = state.tasks.map(t => ({
      id: t.id,
      filePath: t.filePath,
      description: t.description,
      dependencies: t.dependencies,
      type: 'code',
      status: t.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
      result: t.result,
      attempts: t.attempts
    }));

    // Resume scheduler
    this.scheduler.loadPlan(schedulerTasks);
    this.scheduler.resumeFrom(
      Array.from(completedResults.keys()),
      completedResults
    );

    await this.events.emit('phase:start', { phase: 'execution' });
    this.currentState.phase = 'executing';
    await this.scheduler.run();

    // Continue with documentation if needed
    if (state.phase !== 'documenting') {
      await this.events.emit('phase:start', { phase: 'documentation' });
      this.currentState.phase = 'documenting';
      await this.phaseDocument({
        tasks: state.tasks.map(t => ({
          id: t.id,
          file_path: t.filePath,
          description: t.description,
          dependencies: t.dependencies,
          type: 'code' as const
        })),
        architecture_reasoning: state.architectureReasoning
      });
    }

    this.currentState.phase = 'completed';
    await this.checkpoint();
    
    return 'Development cycle complete (resumed from checkpoint).';
  }

  // ===========================================================================
  // Phase Implementations
  // ===========================================================================

  /**
   * Analyze existing codebase for context
   */
  private async analyzeCodebase(path: string): Promise<string> {
    try {
      const files = await this.adapter.fs.listFiles(path, { 
        recursive: true,
        maxDepth: 3 
      });
      
      // Filter to relevant source files
      const sourceFiles = files
        .filter(f => /\.(ts|js|tsx|jsx|json)$/.test(f))
        .slice(0, 30);  // Limit for context window

      const summaries: string[] = [`Files in ${path}:`];
      
      for (const file of sourceFiles.slice(0, 10)) {
        try {
          const content = await this.adapter.fs.readFile(`${path}/${file}`);
          const signature = this.extractor.extract(content);
          if (signature && !signature.includes('No public exports')) {
            summaries.push(`\n// ${file}\n${signature}`);
          }
        } catch {
          // Skip files that can't be read
        }
      }

      return summaries.join('\n');
    } catch {
      return 'No existing codebase found.';
    }
  }

  /**
   * Architect phase - generate implementation plan
   */
  private async phaseArchitect(goal: string, context: string): Promise<ImplementationPlan> {
    this.adapter.log('Phase: Architect (Planning)');
    
    const response = await this.adapter.llm.generate({
      systemPrompt: PROMPTS.ARCHITECT.system,
      userPrompt: PROMPTS.ARCHITECT.userTemplate(goal, context),
      responseFormat: 'json'
    });

    try {
      const cleaned = this.cleanJsonResponse(response);
      return JSON.parse(cleaned) as ImplementationPlan;
    } catch (error) {
      this.adapter.log(`Failed to parse plan: ${error}`, 'error');
      throw new Error(`Architect output invalid JSON: ${response.slice(0, 200)}...`);
    }
  }

  /**
   * Documentation phase - generate README
   */
  private async phaseDocument(plan: ImplementationPlan): Promise<void> {
    this.adapter.log('Phase: Documentation');
    
    const content = await this.adapter.llm.generate({
      systemPrompt: PROMPTS.SCRIBE.system,
      userPrompt: PROMPTS.SCRIBE.readmeTemplate(
        plan.architecture_reasoning,
        plan.tasks.map(t => ({ file_path: t.file_path, description: t.description }))
      )
    });

    await this.adapter.fs.writeFile('README.md', content);
  }

  // ===========================================================================
  // Task Execution
  // ===========================================================================

  /**
   * Execute a single task - called by the scheduler
   */
  private async executeTaskLogic(task: Task): Promise<string> {
    // Update state
    this.updateTaskState(task.id, { status: 'RUNNING', startedAt: new Date() });

    // Build context from dependencies
    const parentContext = this.buildDependencyContext(task);

    // Generate code
    this.adapter.log(`Builder: Implementing ${task.filePath}`);
    let code = await this.generateCode(task, parentContext);
    await this.adapter.fs.writeFile(task.filePath, code);

    // Run verification for code files
    if (this.shouldVerify(task)) {
      code = await this.runVerificationLoop(task, code);
    }

    // Update state
    this.updateTaskState(task.id, { 
      status: 'COMPLETED', 
      result: code,
      completedAt: new Date() 
    });
    await this.checkpoint();

    return code;
  }

  /**
   * Build context from completed dependencies
   */
  private buildDependencyContext(task: Task): string {
    const contexts: string[] = [];
    
    for (const depId of task.dependencies) {
      const result = this.scheduler.getTaskResult(depId);
      if (result) {
        const signature = this.extractor.extract(result);
        if (signature && !signature.includes('No public exports')) {
          contexts.push(signature);
        }
      }
    }

    return contexts.join('\n\n');
  }

  /**
   * Generate code for a task
   */
  private async generateCode(task: Task, context: string): Promise<string> {
    const response = await this.adapter.llm.generate({
      systemPrompt: PROMPTS.BUILDER.system,
      userPrompt: PROMPTS.BUILDER.userTemplate(task.filePath, task.description, context)
    });

    return this.cleanCodeResponse(response);
  }

  /**
   * Check if task should be verified with tests
   */
  private shouldVerify(task: Task): boolean {
    return /\.(ts|js|tsx|jsx)$/.test(task.filePath) && 
           !task.filePath.includes('.test.') &&
           !task.filePath.includes('.spec.');
  }

  /**
   * Run verification loop - generate tests and fix failures
   */
  private async runVerificationLoop(task: Task, initialCode: string): Promise<string> {
    let code = initialCode;
    let attempts = 0;
    const maxAttempts = this.options.maxRetries;

    while (attempts < maxAttempts) {
      attempts++;
      this.adapter.log(`Auditor: Testing ${task.filePath} (attempt ${attempts})`);

      // Generate test file
      const testFile = this.getTestFilePath(task.filePath);
      const testCode = await this.generateTests(task, code);
      await this.adapter.fs.writeFile(testFile, testCode);

      // Run tests
      const testRunner = this.adapter.shell.getTestRunner();
      const result = await testRunner.run(testFile, { 
        timeout: this.options.testTimeout 
      });

      if (result.passed) {
        this.adapter.log(`Tests passed for ${task.filePath}`);
        return code;
      }

      // Classify error and get fix
      this.adapter.log(`Tests failed: ${result.failures[0]?.message || 'Unknown error'}`);
      
      const classified = errorClassifier.classify(result.rawOutput, result.numFailed > 0 ? 1 : 0);
      
      code = await this.attemptFix(task, code, testCode, result.rawOutput, classified.category);
      await this.adapter.fs.writeFile(task.filePath, code);
    }

    throw new Error(`Failed to verify ${task.filePath} after ${maxAttempts} attempts`);
  }

  /**
   * Generate tests for a piece of code
   */
  private async generateTests(task: Task, code: string): Promise<string> {
    const response = await this.adapter.llm.generate({
      systemPrompt: PROMPTS.AUDITOR.system,
      userPrompt: PROMPTS.AUDITOR.userTemplate(code, task.filePath)
    });

    return this.cleanCodeResponse(response);
  }

  /**
   * Attempt to fix code based on test failure
   */
  private async attemptFix(
    task: Task,
    code: string,
    testCode: string,
    errorOutput: string,
    category: ErrorCategory
  ): Promise<string> {
    this.adapter.log(`Fixer: Attempting to fix ${category} error`);

    const fixerPrompt = getFixerPrompt(category);
    
    const response = await this.adapter.llm.generate({
      systemPrompt: fixerPrompt,
      userPrompt: PROMPTS.FIXER.userTemplate(
        task.filePath,
        errorOutput,
        code,
        testCode,
        category
      )
    });

    return this.cleanCodeResponse(response);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Convert plan tasks to scheduler tasks
   */
  private convertPlanToTasks(plan: ImplementationPlan): Task[] {
    return plan.tasks.map(t => ({
      id: t.id,
      filePath: t.file_path,
      description: t.description,
      dependencies: t.dependencies,
      type: t.type,
      priority: t.priority,
      status: 'PENDING' as const,
      attempts: 0,
      maxAttempts: this.options.maxRetries
    }));
  }

  /**
   * Get test file path from source file path
   */
  private getTestFilePath(sourcePath: string): string {
    return sourcePath.replace(/\.(ts|js|tsx|jsx)$/, '.test.$1');
  }

  /**
   * Clean JSON response from LLM
   */
  private cleanJsonResponse(response: string): string {
    return response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
  }

  /**
   * Clean code response from LLM
   */
  private cleanCodeResponse(response: string): string {
    return response
      .replace(/```(?:typescript|javascript|ts|js|tsx|jsx)?\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
  }

  /**
   * Update task state
   */
  private updateTaskState(taskId: string, updates: Partial<TaskState>): void {
    if (this.currentState) {
      const taskIndex = this.currentState.tasks.findIndex(t => t.id === taskId);
      if (taskIndex >= 0) {
        this.currentState.tasks[taskIndex] = {
          ...this.currentState.tasks[taskIndex],
          ...updates
        };
      }
    }
  }

  /**
   * Save checkpoint
   */
  private async checkpoint(): Promise<void> {
    if (this.options.enableCheckpoints && this.currentState) {
      await this.stateManager.save(this.currentState);
      await this.events.emit('checkpoint:saved', { planId: this.currentState.planId });
    }
  }

  /**
   * Get list of generated files
   */
  private getGeneratedFiles(): string[] {
    return this.currentState?.tasks
      .filter(t => t.status === 'COMPLETED')
      .map(t => t.filePath) ?? [];
  }
}

// =============================================================================
// Type Re-exports for API Users
// =============================================================================

// Note: Re-export types only; implementations should be imported from their modules
export type { Task, TaskStatus, SchedulerOptions } from './TaskScheduler.js';
