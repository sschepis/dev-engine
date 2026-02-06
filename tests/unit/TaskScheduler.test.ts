// =============================================================================
// OpenClaw DevEngine - TaskScheduler Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TaskScheduler, Task, SchedulerOptions } from '../../src/core/TaskScheduler.js';
import { createMockAdapter, MockEnvironmentAdapter } from '../mocks/adapters.js';

describe('TaskScheduler', () => {
  let mockAdapter: MockEnvironmentAdapter;
  let executedTasks: string[];
  let executor: jest.Mock<(task: Task) => Promise<string>>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    executedTasks = [];
    executor = jest.fn(async (task: Task) => {
      executedTasks.push(task.id);
      await testUtils.delay(10);  // Simulate work
      return `Result for ${task.id}`;
    });
  });

  function createScheduler(options: SchedulerOptions = {}): TaskScheduler {
    return new TaskScheduler(mockAdapter, executor, options);
  }

  function createTask(overrides: Partial<Task> = {}): Task {
    return {
      id: `task-${testUtils.randomString(4)}`,
      filePath: 'src/test.ts',
      description: 'Test task',
      dependencies: [],
      status: 'PENDING',
      attempts: 0,
      ...overrides
    };
  }

  describe('loadPlan()', () => {
    it('should load tasks into the scheduler', () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'task-1' }),
        createTask({ id: 'task-2' })
      ];

      scheduler.loadPlan(tasks);
      const status = scheduler.getStatus();

      expect(status.tasks).toHaveLength(2);
      expect(status.summary.PENDING).toBe(2);
    });

    it('should reset state when loading new plan', () => {
      const scheduler = createScheduler();
      
      scheduler.loadPlan([createTask({ id: 'old-task' })]);
      scheduler.loadPlan([createTask({ id: 'new-task' })]);
      
      const status = scheduler.getStatus();
      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0].id).toBe('new-task');
    });

    it('should calculate indegrees correctly', () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'base', dependencies: [] }),
        createTask({ id: 'child', dependencies: ['base'] }),
        createTask({ id: 'grandchild', dependencies: ['child'] })
      ];

      scheduler.loadPlan(tasks);
      // If run, 'base' should execute first
    });

    it('should warn about missing dependencies', () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'child', dependencies: ['nonexistent'] })
      ];

      scheduler.loadPlan(tasks);
      
      expect(mockAdapter.logger.hasLogMatching('warn', 'nonexistent')).toBe(true);
    });
  });

  describe('run()', () => {
    it('should execute independent tasks in parallel', async () => {
      const scheduler = createScheduler({ maxConcurrency: 10 });
      const tasks = [
        createTask({ id: 'a' }),
        createTask({ id: 'b' }),
        createTask({ id: 'c' })
      ];

      scheduler.loadPlan(tasks);
      await scheduler.run();

      expect(executedTasks).toHaveLength(3);
      expect(executor).toHaveBeenCalledTimes(3);
    });

    it('should respect dependencies', async () => {
      const scheduler = createScheduler({ maxConcurrency: 10 });
      const tasks = [
        createTask({ id: 'base', dependencies: [] }),
        createTask({ id: 'dependent', dependencies: ['base'] })
      ];

      scheduler.loadPlan(tasks);
      await scheduler.run();

      const baseIndex = executedTasks.indexOf('base');
      const dependentIndex = executedTasks.indexOf('dependent');
      
      expect(baseIndex).toBeLessThan(dependentIndex);
    });

    it('should respect concurrency limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const trackingExecutor = jest.fn(async (task: Task) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await testUtils.delay(50);
        currentConcurrent--;
        return `Result for ${task.id}`;
      });

      const scheduler = new TaskScheduler(mockAdapter, trackingExecutor, { 
        maxConcurrency: 2 
      });
      
      const tasks = Array.from({ length: 5 }, (_, i) => 
        createTask({ id: `task-${i}` })
      );

      scheduler.loadPlan(tasks);
      await scheduler.run();

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(trackingExecutor).toHaveBeenCalledTimes(5);
    });

    it('should detect circular dependencies', async () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'a', dependencies: ['b'] }),
        createTask({ id: 'b', dependencies: ['a'] })
      ];

      scheduler.loadPlan(tasks);
      
      await expect(scheduler.run()).rejects.toThrow('Circular dependency');
    });

    it('should handle missing dependency gracefully', async () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'orphan', dependencies: ['missing'] })
      ];

      scheduler.loadPlan(tasks);
      
      // Missing dependencies are warned but don't block execution
      // The task will run since the missing dependency isn't in the plan
      await scheduler.run();
      
      // Task should complete since the warning was logged but execution continued
      const status = scheduler.getStatus();
      expect(status.summary.COMPLETED).toBe(1);
    });

    it('should emit events during execution', async () => {
      const scheduler = createScheduler();
      const events: string[] = [];
      
      scheduler.events.on('task:start', async () => { events.push('start'); });
      scheduler.events.on('task:complete', async () => { events.push('complete'); });

      scheduler.loadPlan([createTask({ id: 'test' })]);
      await scheduler.run();

      expect(events).toContain('start');
      expect(events).toContain('complete');
    });
  });

  describe('error handling', () => {
    it('should retry failed tasks', async () => {
      let attempts = 0;
      const failingExecutor = jest.fn(async (task: Task) => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'Success';
      });

      const scheduler = new TaskScheduler(mockAdapter, failingExecutor, {
        defaultMaxAttempts: 3,
        retryDelay: 10
      });

      scheduler.loadPlan([createTask({ id: 'flaky' })]);
      await scheduler.run();

      expect(attempts).toBe(3);
      expect(failingExecutor).toHaveBeenCalledTimes(3);
    });

    it('should mark task as failed after max retries', async () => {
      const failingExecutor = jest.fn(async () => {
        throw new Error('Persistent failure');
      });

      const scheduler = new TaskScheduler(mockAdapter, failingExecutor, {
        defaultMaxAttempts: 2,
        retryDelay: 10
      });

      scheduler.loadPlan([createTask({ id: 'failing' })]);
      
      await expect(scheduler.run()).rejects.toThrow('task(s) failed');
      
      const status = scheduler.getStatus();
      expect(status.summary.FAILED).toBe(1);
    });

    it('should skip dependent tasks when parent fails', async () => {
      const failingExecutor = jest.fn(async (task: Task) => {
        if (task.id === 'parent') {
          throw new Error('Parent failed');
        }
        return 'Success';
      });

      const scheduler = new TaskScheduler(mockAdapter, failingExecutor, {
        defaultMaxAttempts: 1
      });

      scheduler.loadPlan([
        createTask({ id: 'parent', dependencies: [] }),
        createTask({ id: 'child', dependencies: ['parent'] })
      ]);

      await expect(scheduler.run()).rejects.toThrow();
      
      const status = scheduler.getStatus();
      expect(status.summary.FAILED).toBe(1);
      expect(status.summary.SKIPPED).toBe(1);
    });

    it('should emit retry events', async () => {
      let attempts = 0;
      const failingExecutor = jest.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry me');
        }
        return 'Success';
      });

      const scheduler = new TaskScheduler(mockAdapter, failingExecutor, {
        defaultMaxAttempts: 3,
        retryDelay: 10
      });

      const retryEvents: unknown[] = [];
      scheduler.events.on('task:retry', async (e) => { retryEvents.push(e); });

      scheduler.loadPlan([createTask({ id: 'retrying' })]);
      await scheduler.run();

      expect(retryEvents).toHaveLength(1);
    });
  });

  describe('getTaskResult()', () => {
    it('should return result of completed task', async () => {
      const scheduler = createScheduler();
      scheduler.loadPlan([createTask({ id: 'test' })]);
      await scheduler.run();

      const result = scheduler.getTaskResult('test');
      expect(result).toBe('Result for test');
    });

    it('should return undefined for non-existent task', () => {
      const scheduler = createScheduler();
      scheduler.loadPlan([createTask({ id: 'test' })]);

      const result = scheduler.getTaskResult('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllResults()', () => {
    it('should return all completed results', async () => {
      const scheduler = createScheduler();
      scheduler.loadPlan([
        createTask({ id: 'a' }),
        createTask({ id: 'b' }),
        createTask({ id: 'c' })
      ]);
      await scheduler.run();

      const results = scheduler.getAllResults();
      expect(results.size).toBe(3);
      expect(results.get('a')).toBe('Result for a');
      expect(results.get('b')).toBe('Result for b');
      expect(results.get('c')).toBe('Result for c');
    });
  });

  describe('getStatus()', () => {
    it('should return current task statuses', async () => {
      const scheduler = createScheduler();
      scheduler.loadPlan([
        createTask({ id: 'a' }),
        createTask({ id: 'b' })
      ]);

      let status = scheduler.getStatus();
      expect(status.summary.PENDING).toBe(2);

      await scheduler.run();

      status = scheduler.getStatus();
      expect(status.summary.COMPLETED).toBe(2);
      expect(status.summary.PENDING).toBe(0);
    });
  });

  describe('resumeFrom()', () => {
    it('should resume with completed tasks', async () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'done', dependencies: [] }),
        createTask({ id: 'todo', dependencies: ['done'] })
      ];

      scheduler.loadPlan(tasks);
      
      // Simulate 'done' was completed previously
      scheduler.resumeFrom(['done'], new Map([['done', 'Previous result']]));

      await scheduler.run();

      // Only 'todo' should have been executed
      expect(executedTasks).toEqual(['todo']);
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });

  describe('priority handling', () => {
    it('should execute higher priority tasks first when ready', async () => {
      const scheduler = createScheduler({ maxConcurrency: 1 });
      const tasks = [
        createTask({ id: 'low', priority: 1 }),
        createTask({ id: 'high', priority: 10 }),
        createTask({ id: 'medium', priority: 5 })
      ];

      scheduler.loadPlan(tasks);
      await scheduler.run();

      // With concurrency 1, should execute in priority order
      expect(executedTasks[0]).toBe('high');
    });
  });

  describe('task types', () => {
    it('should handle different task types', async () => {
      const scheduler = createScheduler();
      const tasks = [
        createTask({ id: 'code', type: 'code' }),
        createTask({ id: 'test', type: 'test', dependencies: ['code'] }),
        createTask({ id: 'docs', type: 'docs', dependencies: ['code'] })
      ];

      scheduler.loadPlan(tasks);
      await scheduler.run();

      expect(executedTasks).toContain('code');
      expect(executedTasks).toContain('test');
      expect(executedTasks).toContain('docs');
    });
  });
});
