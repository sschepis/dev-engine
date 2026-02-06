// =============================================================================
// OpenClaw DevEngine - StateManager Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach } from '@jest/globals';
import { StateManager } from '../../src/core/StateManager.js';
import { ExecutionState, TaskState } from '../../src/interfaces/index.js';
import { createMockFS, MockFileSystem } from '../mocks/adapters.js';

describe('StateManager', () => {
  let mockFS: MockFileSystem;
  let stateManager: StateManager;

  beforeEach(() => {
    mockFS = createMockFS();
    stateManager = new StateManager(mockFS, { stateDir: '.openclaw/state' });
  });

  function createTestState(overrides: Partial<ExecutionState> = {}): ExecutionState {
    return {
      planId: `plan-${testUtils.randomString(8)}`,
      goal: 'Test goal',
      phase: 'executing',
      tasks: [],
      architectureReasoning: 'Test architecture',
      startedAt: new Date(),
      lastCheckpoint: new Date(),
      ...overrides
    };
  }

  function createTaskState(overrides: Partial<TaskState> = {}): TaskState {
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

  describe('generatePlanId()', () => {
    it('should generate unique plan IDs', () => {
      const id1 = StateManager.generatePlanId('goal 1');
      const id2 = StateManager.generatePlanId('goal 2');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^plan-[a-f0-9]+-[a-z0-9]+$/);
    });

    it('should include goal hash in ID', () => {
      const id1 = StateManager.generatePlanId('same goal');
      const id2 = StateManager.generatePlanId('same goal');

      // Same goal produces same hash prefix
      const hash1 = id1.split('-')[1];
      const hash2 = id2.split('-')[1];
      expect(hash1).toBe(hash2);
    });
  });

  describe('save()', () => {
    it('should save state to file', async () => {
      const state = createTestState({ planId: 'test-plan' });

      await stateManager.save(state);

      const written = mockFS.getWrittenContent('.openclaw/state/test-plan.json');
      expect(written).toBeDefined();
      
      const parsed = JSON.parse(written as string);
      expect(parsed.planId).toBe('test-plan');
      expect(parsed.goal).toBe('Test goal');
    });

    it('should create state directory if needed', async () => {
      const state = createTestState();

      await stateManager.save(state);

      expect(mockFS.calls.mkdir).toContainEqual('.openclaw/state');
    });

    it('should serialize dates as ISO strings', async () => {
      const state = createTestState({
        planId: 'date-test',
        startedAt: new Date('2024-01-15T10:30:00Z')
      });

      await stateManager.save(state);

      const written = mockFS.getWrittenContent('.openclaw/state/date-test.json');
      const parsed = JSON.parse(written as string);
      expect(parsed.startedAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should serialize task dates', async () => {
      const state = createTestState({
        planId: 'task-date-test',
        tasks: [
          createTaskState({
            id: 'task-1',
            startedAt: new Date('2024-01-15T10:30:00Z'),
            completedAt: new Date('2024-01-15T10:35:00Z')
          })
        ]
      });

      await stateManager.save(state);

      const written = mockFS.getWrittenContent('.openclaw/state/task-date-test.json');
      const parsed = JSON.parse(written as string);
      expect(parsed.tasks[0].startedAt).toBe('2024-01-15T10:30:00.000Z');
      expect(parsed.tasks[0].completedAt).toBe('2024-01-15T10:35:00.000Z');
    });

    it('should update lastCheckpoint on save', async () => {
      const oldDate = new Date('2024-01-01');
      const state = createTestState({ 
        planId: 'checkpoint-test',
        lastCheckpoint: oldDate 
      });

      await stateManager.save(state);

      const written = mockFS.getWrittenContent('.openclaw/state/checkpoint-test.json');
      const parsed = JSON.parse(written as string);
      
      const savedDate = new Date(parsed.lastCheckpoint);
      expect(savedDate.getTime()).toBeGreaterThan(oldDate.getTime());
    });
  });

  describe('load()', () => {
    it('should load state from file', async () => {
      const state = createTestState({ planId: 'load-test', goal: 'Load test goal' });
      await stateManager.save(state);

      const loaded = await stateManager.load('load-test');

      expect(loaded).not.toBeNull();
      expect(loaded?.planId).toBe('load-test');
      expect(loaded?.goal).toBe('Load test goal');
    });

    it('should return null for non-existent state', async () => {
      const loaded = await stateManager.load('nonexistent');

      expect(loaded).toBeNull();
    });

    it('should deserialize dates correctly', async () => {
      mockFS.seedFile('.openclaw/state/date-load.json', JSON.stringify({
        planId: 'date-load',
        goal: 'Test',
        phase: 'executing',
        tasks: [],
        architectureReasoning: 'Test',
        startedAt: '2024-01-15T10:30:00.000Z',
        lastCheckpoint: '2024-01-15T10:35:00.000Z'
      }));

      const loaded = await stateManager.load('date-load');

      expect(loaded?.startedAt).toBeInstanceOf(Date);
      expect(loaded?.lastCheckpoint).toBeInstanceOf(Date);
      expect(loaded?.startedAt.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should deserialize task dates', async () => {
      mockFS.seedFile('.openclaw/state/task-load.json', JSON.stringify({
        planId: 'task-load',
        goal: 'Test',
        phase: 'executing',
        architectureReasoning: 'Test',
        startedAt: '2024-01-15T10:30:00.000Z',
        lastCheckpoint: '2024-01-15T10:35:00.000Z',
        tasks: [{
          id: 'task-1',
          filePath: 'test.ts',
          description: 'Test',
          dependencies: [],
          status: 'COMPLETED',
          attempts: 1,
          startedAt: '2024-01-15T10:30:00.000Z',
          completedAt: '2024-01-15T10:32:00.000Z'
        }]
      }));

      const loaded = await stateManager.load('task-load');

      expect(loaded?.tasks[0].startedAt).toBeInstanceOf(Date);
      expect(loaded?.tasks[0].completedAt).toBeInstanceOf(Date);
    });

    it('should return null for corrupted JSON', async () => {
      mockFS.seedFile('.openclaw/state/corrupted.json', 'not valid json {{{');

      const loaded = await stateManager.load('corrupted');

      expect(loaded).toBeNull();
    });
  });

  describe('exists()', () => {
    it('should return true for existing state', async () => {
      const state = createTestState({ planId: 'exists-test' });
      await stateManager.save(state);

      const exists = await stateManager.exists('exists-test');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent state', async () => {
      const exists = await stateManager.exists('nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('list()', () => {
    it('should list all saved plan IDs', async () => {
      await stateManager.save(createTestState({ planId: 'plan-a' }));
      await stateManager.save(createTestState({ planId: 'plan-b' }));
      await stateManager.save(createTestState({ planId: 'plan-c' }));

      const plans = await stateManager.list();

      expect(plans).toContain('plan-a');
      expect(plans).toContain('plan-b');
      expect(plans).toContain('plan-c');
    });

    it('should return empty array if no states exist', async () => {
      const plans = await stateManager.list();

      expect(plans).toEqual([]);
    });
  });

  describe('delete()', () => {
    it('should delete saved state', async () => {
      const state = createTestState({ planId: 'delete-test' });
      await stateManager.save(state);

      await stateManager.delete('delete-test');

      const exists = await stateManager.exists('delete-test');
      expect(exists).toBe(false);
    });

    it('should not throw for non-existent state', async () => {
      await expect(stateManager.delete('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('findLatestForGoal()', () => {
    it('should find most recent checkpoint for a goal', async () => {
      const goal = 'Find latest goal';
      
      // Save first checkpoint
      await stateManager.save(createTestState({
        planId: 'old-plan',
        goal
      }));

      // Small delay to ensure different timestamps
      await testUtils.delay(10);

      // Save second checkpoint
      await stateManager.save(createTestState({
        planId: 'new-plan',
        goal
      }));

      const latest = await stateManager.findLatestForGoal(goal);

      // Note: save() always updates lastCheckpoint to current time,
      // so the second save will have a later timestamp
      expect(latest?.planId).toBe('new-plan');
    });

    it('should return null if no matching goal', async () => {
      await stateManager.save(createTestState({
        planId: 'different-goal',
        goal: 'Different goal'
      }));

      const latest = await stateManager.findLatestForGoal('Nonexistent goal');

      expect(latest).toBeNull();
    });
  });

  describe('cleanup()', () => {
    it('should keep only N most recent checkpoints', async () => {
      // Create 5 checkpoints
      for (let i = 0; i < 5; i++) {
        await stateManager.save(createTestState({
          planId: `plan-${i}`,
          lastCheckpoint: new Date(Date.now() + i * 1000)
        }));
      }

      const deleted = await stateManager.cleanup(3);

      expect(deleted).toBe(2);
      
      const remaining = await stateManager.list();
      expect(remaining.length).toBe(3);
    });

    it('should not delete if under limit', async () => {
      await stateManager.save(createTestState({ planId: 'plan-1' }));
      await stateManager.save(createTestState({ planId: 'plan-2' }));

      const deleted = await stateManager.cleanup(5);

      expect(deleted).toBe(0);
    });
  });

  describe('static helpers', () => {
    describe('createInitialState()', () => {
      it('should create initial execution state', () => {
        const state = StateManager.createInitialState('My goal');

        expect(state.goal).toBe('My goal');
        expect(state.phase).toBe('planning');
        expect(state.tasks).toEqual([]);
        expect(state.planId).toMatch(/^plan-/);
        expect(state.startedAt).toBeInstanceOf(Date);
      });
    });

    describe('updateTaskState()', () => {
      it('should update specific task in state', () => {
        const state = createTestState({
          tasks: [
            createTaskState({ id: 'task-1', status: 'PENDING' }),
            createTaskState({ id: 'task-2', status: 'PENDING' })
          ]
        });

        const updated = StateManager.updateTaskState(state, 'task-1', {
          status: 'COMPLETED',
          result: 'Done!'
        });

        expect(updated.tasks[0].status).toBe('COMPLETED');
        expect(updated.tasks[0].result).toBe('Done!');
        expect(updated.tasks[1].status).toBe('PENDING');
      });

      it('should update lastCheckpoint', () => {
        const oldDate = new Date('2024-01-01');
        const state = createTestState({ lastCheckpoint: oldDate });

        const updated = StateManager.updateTaskState(state, 'any', {});

        expect(updated.lastCheckpoint.getTime()).toBeGreaterThan(oldDate.getTime());
      });
    });

    describe('getResumableTasks()', () => {
      it('should return pending and running tasks', () => {
        const state = createTestState({
          tasks: [
            createTaskState({ id: 'completed', status: 'COMPLETED' }),
            createTaskState({ id: 'pending', status: 'PENDING' }),
            createTaskState({ id: 'running', status: 'RUNNING' }),
            createTaskState({ id: 'failed', status: 'FAILED' })
          ]
        });

        const resumable = StateManager.getResumableTasks(state);

        expect(resumable).toHaveLength(2);
        expect(resumable.map(t => t.id)).toContain('pending');
        expect(resumable.map(t => t.id)).toContain('running');
      });
    });

    describe('isComplete()', () => {
      it('should return true if phase is completed', () => {
        const state = createTestState({ phase: 'completed' });

        expect(StateManager.isComplete(state)).toBe(true);
      });

      it('should return true if all tasks are completed', () => {
        const state = createTestState({
          phase: 'executing',
          tasks: [
            createTaskState({ status: 'COMPLETED' }),
            createTaskState({ status: 'COMPLETED' })
          ]
        });

        expect(StateManager.isComplete(state)).toBe(true);
      });

      it('should return false if tasks are still pending', () => {
        const state = createTestState({
          phase: 'executing',
          tasks: [
            createTaskState({ status: 'COMPLETED' }),
            createTaskState({ status: 'PENDING' })
          ]
        });

        expect(StateManager.isComplete(state)).toBe(false);
      });
    });

    describe('isFatallyFailed()', () => {
      it('should return true if failed with max attempts', () => {
        const state = createTestState({
          phase: 'failed',
          tasks: [
            createTaskState({ status: 'FAILED', attempts: 3 })
          ]
        });

        expect(StateManager.isFatallyFailed(state)).toBe(true);
      });

      it('should return false if phase is not failed', () => {
        const state = createTestState({
          phase: 'executing',
          tasks: [
            createTaskState({ status: 'FAILED', attempts: 3 })
          ]
        });

        expect(StateManager.isFatallyFailed(state)).toBe(false);
      });

      it('should return false if attempts are under max', () => {
        const state = createTestState({
          phase: 'failed',
          tasks: [
            createTaskState({ status: 'FAILED', attempts: 1 })
          ]
        });

        expect(StateManager.isFatallyFailed(state)).toBe(false);
      });
    });
  });
});
