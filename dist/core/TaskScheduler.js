// =============================================================================
// OpenClaw DevEngine - Task Scheduler with Concurrency Control
// =============================================================================
// -----------------------------------------------------------------------------
// Semaphore for Concurrency Control
// -----------------------------------------------------------------------------
class Semaphore {
    permits;
    waiting = [];
    constructor(permits) {
        this.permits = permits;
    }
    async acquire() {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        return new Promise(resolve => {
            this.waiting.push(resolve);
        });
    }
    release() {
        this.permits++;
        const next = this.waiting.shift();
        if (next) {
            this.permits--;
            next();
        }
    }
    get available() {
        return this.permits;
    }
}
// -----------------------------------------------------------------------------
// Event Emitter Implementation
// -----------------------------------------------------------------------------
export class SchedulerEventEmitter {
    handlers = new Map();
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
    }
    off(event, handler) {
        this.handlers.get(event)?.delete(handler);
    }
    once(event, handler) {
        const wrappedHandler = async (e) => {
            this.off(event, wrappedHandler);
            await handler(e);
        };
        this.on(event, wrappedHandler);
    }
    async emit(event, data) {
        const eventObj = {
            type: event,
            timestamp: new Date(),
            data
        };
        const handlers = this.handlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    await handler(eventObj);
                }
                catch (error) {
                    console.error(`Event handler error for ${event}:`, error);
                }
            }
        }
    }
}
// -----------------------------------------------------------------------------
// Task Scheduler
// -----------------------------------------------------------------------------
export class TaskScheduler {
    adapter;
    executor;
    tasks = new Map();
    dependents = new Map(); // Parent -> Children
    indegree = new Map(); // Task -> Pending dependencies
    semaphore;
    runningTasks = new Set();
    completedTasks = new Set();
    failedTasks = new Set();
    options;
    events;
    constructor(adapter, executor, options = {}) {
        this.adapter = adapter;
        this.executor = executor;
        this.options = {
            maxConcurrency: options.maxConcurrency ?? 3,
            defaultMaxAttempts: options.defaultMaxAttempts ?? 3,
            taskTimeout: options.taskTimeout ?? 300000, // 5 minutes
            retryDelay: options.retryDelay ?? 1000
        };
        this.semaphore = new Semaphore(this.options.maxConcurrency);
        this.events = new SchedulerEventEmitter();
    }
    /**
     * Load a plan of tasks into the scheduler
     */
    loadPlan(taskList) {
        this.reset();
        // Initialize all tasks
        for (const task of taskList) {
            const normalizedTask = {
                ...task,
                status: 'PENDING',
                attempts: 0,
                maxAttempts: task.maxAttempts ?? this.options.defaultMaxAttempts
            };
            this.tasks.set(task.id, normalizedTask);
            this.indegree.set(task.id, 0);
            this.dependents.set(task.id, []);
        }
        // Build dependency graph
        for (const task of taskList) {
            for (const parentId of task.dependencies) {
                // Validate dependency exists
                if (!this.tasks.has(parentId)) {
                    this.adapter.log(`Warning: Task ${task.id} depends on unknown task ${parentId}`, 'warn');
                    continue;
                }
                // Parent -> Child relationship
                this.dependents.get(parentId).push(task.id);
                // Increment child's indegree
                this.indegree.set(task.id, (this.indegree.get(task.id) ?? 0) + 1);
            }
        }
    }
    /**
     * Resume from a partially completed state
     */
    resumeFrom(completedTaskIds, results) {
        for (const taskId of completedTaskIds) {
            const task = this.tasks.get(taskId);
            if (task) {
                task.status = 'COMPLETED';
                task.result = results.get(taskId);
                this.completedTasks.add(taskId);
                // Decrement indegrees of dependents
                for (const childId of this.dependents.get(taskId) ?? []) {
                    const currentIndegree = this.indegree.get(childId) ?? 0;
                    this.indegree.set(childId, Math.max(0, currentIndegree - 1));
                }
            }
        }
    }
    /**
     * Execute all tasks in the plan
     */
    async run() {
        await this.events.emit('engine:start', { taskCount: this.tasks.size });
        // Detect circular dependencies
        if (this.hasCircularDependency()) {
            throw new Error('Circular dependency detected in task plan');
        }
        // Get initial batch (tasks with no dependencies)
        const initialBatch = this.getReadyTasks();
        if (initialBatch.length === 0 && this.tasks.size > 0) {
            throw new Error('No tasks are ready to execute. Check dependency configuration.');
        }
        // Start initial batch
        const promises = initialBatch.map(task => this.scheduleTask(task));
        // Wait for all tasks to complete
        await this.waitForCompletion();
        // Check for failures
        if (this.failedTasks.size > 0) {
            throw new Error(`${this.failedTasks.size} task(s) failed: ${Array.from(this.failedTasks).join(', ')}`);
        }
        await this.events.emit('engine:complete', {
            completed: this.completedTasks.size,
            failed: this.failedTasks.size
        });
    }
    /**
     * Schedule a single task for execution
     */
    async scheduleTask(task) {
        task.status = 'QUEUED';
        // Acquire semaphore permit
        await this.semaphore.acquire();
        try {
            await this.executeTask(task);
        }
        finally {
            this.semaphore.release();
        }
    }
    /**
     * Execute a task with retries and timeout
     */
    async executeTask(task) {
        task.status = 'RUNNING';
        task.startedAt = new Date();
        task.attempts++;
        this.runningTasks.add(task.id);
        await this.events.emit('task:start', {
            taskId: task.id,
            filePath: task.filePath,
            attempt: task.attempts
        });
        this.adapter.log(`Starting: ${task.id} (${task.filePath}) [Attempt ${task.attempts}]`);
        try {
            // Execute with timeout
            const result = await this.executeWithTimeout(task);
            // Success
            task.status = 'COMPLETED';
            task.result = result;
            task.completedAt = new Date();
            this.runningTasks.delete(task.id);
            this.completedTasks.add(task.id);
            await this.events.emit('task:complete', {
                taskId: task.id,
                duration: task.completedAt.getTime() - task.startedAt.getTime()
            });
            this.adapter.log(`Completed: ${task.id}`);
            // Trigger dependent tasks
            await this.onTaskCompleted(task.id);
        }
        catch (error) {
            this.runningTasks.delete(task.id);
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (task.attempts < (task.maxAttempts ?? this.options.defaultMaxAttempts)) {
                // Retry
                await this.events.emit('task:retry', {
                    taskId: task.id,
                    attempt: task.attempts,
                    error: errorMessage
                });
                this.adapter.log(`Retrying: ${task.id} (Attempt ${task.attempts + 1})`);
                await this.delay(this.options.retryDelay);
                // Reschedule
                await this.scheduleTask(task);
            }
            else {
                // Final failure
                task.status = 'FAILED';
                task.error = errorMessage;
                task.completedAt = new Date();
                this.failedTasks.add(task.id);
                await this.events.emit('task:failed', {
                    taskId: task.id,
                    error: errorMessage,
                    attempts: task.attempts
                });
                this.adapter.log(`Failed: ${task.id} after ${task.attempts} attempts`, 'error');
                // Skip dependent tasks
                await this.skipDependentTasks(task.id);
            }
        }
    }
    /**
     * Execute task with timeout
     */
    async executeWithTimeout(task) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Task ${task.id} timed out after ${this.options.taskTimeout}ms`));
            }, this.options.taskTimeout);
            this.executor(task)
                .then(result => {
                clearTimeout(timeout);
                resolve(result);
            })
                .catch(error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    /**
     * Handle task completion - trigger ready dependents
     */
    async onTaskCompleted(taskId) {
        const children = this.dependents.get(taskId) ?? [];
        const newlyReady = [];
        for (const childId of children) {
            const currentIndegree = (this.indegree.get(childId) ?? 0) - 1;
            this.indegree.set(childId, currentIndegree);
            if (currentIndegree === 0) {
                const childTask = this.tasks.get(childId);
                if (childTask.status === 'PENDING') {
                    newlyReady.push(childTask);
                }
            }
        }
        // Schedule newly ready tasks
        for (const task of newlyReady) {
            // Don't await - let them run in parallel
            this.scheduleTask(task);
        }
    }
    /**
     * Skip all tasks that depend on a failed task
     */
    async skipDependentTasks(failedTaskId) {
        const toSkip = [];
        const visited = new Set();
        const queue = [...(this.dependents.get(failedTaskId) ?? [])];
        while (queue.length > 0) {
            const taskId = queue.shift();
            if (visited.has(taskId))
                continue;
            visited.add(taskId);
            toSkip.push(taskId);
            queue.push(...(this.dependents.get(taskId) ?? []));
        }
        for (const taskId of toSkip) {
            const task = this.tasks.get(taskId);
            task.status = 'SKIPPED';
            task.error = `Skipped due to failed dependency: ${failedTaskId}`;
            this.failedTasks.add(taskId);
        }
    }
    /**
     * Get tasks that are ready to execute
     */
    getReadyTasks() {
        return Array.from(this.tasks.values())
            .filter(t => t.status === 'PENDING' &&
            (this.indegree.get(t.id) ?? 0) === 0)
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
    /**
     * Wait for all tasks to complete
     */
    waitForCompletion() {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const allTasks = Array.from(this.tasks.values());
                const pending = allTasks.filter(t => t.status === 'PENDING' ||
                    t.status === 'QUEUED' ||
                    t.status === 'RUNNING');
                if (pending.length === 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
    }
    /**
     * Detect circular dependencies using DFS
     */
    hasCircularDependency() {
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map();
        for (const taskId of this.tasks.keys()) {
            color.set(taskId, WHITE);
        }
        const dfs = (taskId) => {
            color.set(taskId, GRAY);
            for (const childId of this.dependents.get(taskId) ?? []) {
                if (color.get(childId) === GRAY) {
                    return true; // Back edge = cycle
                }
                if (color.get(childId) === WHITE && dfs(childId)) {
                    return true;
                }
            }
            color.set(taskId, BLACK);
            return false;
        };
        for (const taskId of this.tasks.keys()) {
            if (color.get(taskId) === WHITE && dfs(taskId)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Get the result of a completed task
     */
    getTaskResult(id) {
        return this.tasks.get(id)?.result;
    }
    /**
     * Get all task results
     */
    getAllResults() {
        const results = new Map();
        for (const [id, task] of this.tasks) {
            if (task.result) {
                results.set(id, task.result);
            }
        }
        return results;
    }
    /**
     * Get current status of all tasks
     */
    getStatus() {
        const tasks = Array.from(this.tasks.values());
        const summary = {
            PENDING: 0,
            QUEUED: 0,
            RUNNING: 0,
            COMPLETED: 0,
            FAILED: 0,
            SKIPPED: 0
        };
        for (const task of tasks) {
            summary[task.status]++;
        }
        return { tasks, summary };
    }
    /**
     * Reset scheduler state
     */
    reset() {
        this.tasks.clear();
        this.dependents.clear();
        this.indegree.clear();
        this.runningTasks.clear();
        this.completedTasks.clear();
        this.failedTasks.clear();
    }
    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
